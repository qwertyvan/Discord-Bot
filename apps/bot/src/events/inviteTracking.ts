import { Events, type Client, type GuildMember } from 'discord.js';
import { log } from '../logger.js';
import { api, ApiError } from '../api-client.js';
import { diffOnJoin, refreshGuildInvites } from '../util/invite-cache.js';

// Members who join and then leave inside this window are flagged as fake
// invites so the leaderboard doesn't reward bouncers / alt-account farms.
// Configurable via the FAKE_INVITE_GRACE_HOURS env var; defaults to 24h.
const FAKE_INVITE_GRACE_HOURS = (() => {
  const raw = process.env['FAKE_INVITE_GRACE_HOURS'];
  if (!raw) return 24;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 24;
})();
const FAKE_INVITE_GRACE_MS = FAKE_INVITE_GRACE_HOURS * 60 * 60 * 1000;

export function registerInviteTracking(client: Client): void {
  // Once the bot is ready, prime the cache for every guild we're in. This
  // makes the first join after restart resolve correctly; otherwise the
  // diff has nothing to compare against.
  client.once(Events.ClientReady, async (c) => {
    for (const guild of c.guilds.cache.values()) {
      // Best-effort; missing Manage Server perms is common and we just skip.
      await refreshGuildInvites(guild).catch((err) => {
        log.info('invite-cache: prime failed', { guildId: guild.id, err: String(err) });
      });
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot) return;
    const guildId = member.guild.id;

    let diff: Awaited<ReturnType<typeof diffOnJoin>> = null;
    try {
      diff = await diffOnJoin(member.guild);
    } catch (err) {
      log.warn('invite-tracker: diff failed', { guildId, err: String(err) });
    }

    try {
      await api.recordMemberInvite(guildId, {
        userId: member.id,
        inviterId: diff?.inviterId ?? null,
        inviteCode: diff?.code ?? null,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return;
      log.warn('invite-tracker: recordMemberInvite failed', {
        guildId,
        userId: member.id,
        err: String(err),
      });
    }

    // Check leave history: if this user previously had a MemberInvite row and
    // is now rejoining under a *different* invite code, the original invite
    // was fake (alt-style behaviour). We can't easily look that up here
    // without an extra API roundtrip — instead the leftAt+rejoin pattern is
    // covered by the fact that the new join overwrites the row via upsert.

    if (diff?.code) {
      await applyInviteGatedRoles(member, diff.code);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    if (member.user.bot) return;
    const guildId = member.guild.id;
    const leftAt = new Date();

    let prior: Awaited<ReturnType<typeof api.updateMemberInvite>> | null = null;
    try {
      prior = await api.updateMemberInvite(guildId, member.id, {
        leftAt: leftAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return;
      log.warn('invite-tracker: updateMemberInvite (leftAt) failed', {
        guildId,
        userId: member.id,
        err: String(err),
      });
      return;
    }

    if (!prior) return;
    const joinedAt = new Date(prior.joinedAt).getTime();
    const gap = leftAt.getTime() - joinedAt;
    if (gap >= 0 && gap < FAKE_INVITE_GRACE_MS && !prior.isFake) {
      try {
        await api.updateMemberInvite(guildId, member.id, { isFake: true });
      } catch (err) {
        log.warn('invite-tracker: updateMemberInvite (isFake) failed', {
          guildId,
          userId: member.id,
          err: String(err),
        });
      }
    }
  });

  client.on(Events.InviteCreate, async (invite) => {
    if (!invite.guild) return;
    try {
      await api.upsertInvite(invite.guild.id, {
        code: invite.code,
        inviterId: invite.inviter?.id ?? null,
        channelId: invite.channel?.id ?? null,
        maxUses: invite.maxUses ?? null,
        uses: invite.uses ?? 0,
        expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
      });
    } catch (err) {
      log.warn('invite-tracker: upsertInvite on InviteCreate failed', {
        guildId: invite.guild.id,
        code: invite.code,
        err: String(err),
      });
    }
    // Refresh cache so diffOnJoin sees the new entry.
    if (invite.guild.id) {
      const { addInviteToCache } = await import('../util/invite-cache.js');
      addInviteToCache(invite.guild.id, invite.code, invite.uses ?? 0);
    }
  });

  client.on(Events.InviteDelete, async (invite) => {
    if (!invite.guild) return;
    try {
      await api.deleteInvite(invite.guild.id, invite.code);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Already gone — fine.
      } else {
        log.warn('invite-tracker: deleteInvite on InviteDelete failed', {
          guildId: invite.guild.id,
          code: invite.code,
          err: String(err),
        });
      }
    }
    const { dropInviteFromCache } = await import('../util/invite-cache.js');
    dropInviteFromCache(invite.guild.id, invite.code);
  });
}

async function applyInviteGatedRoles(member: GuildMember, code: string): Promise<void> {
  let rules: Awaited<ReturnType<typeof api.listInviteGatedRoles>>;
  try {
    rules = await api.listInviteGatedRoles(member.guild.id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return;
    log.warn('invite-tracker: listInviteGatedRoles failed', {
      guildId: member.guild.id,
      err: String(err),
    });
    return;
  }
  const matching = rules.rules.filter((r) => r.inviteCode === code);
  for (const rule of matching) {
    try {
      await member.roles.add(rule.roleId, `Invite-gated role for code ${code}`);
    } catch (err) {
      log.warn('invite-tracker: role add failed', {
        guildId: member.guild.id,
        userId: member.id,
        roleId: rule.roleId,
        err: String(err),
      });
    }
  }
}
