import type { Guild, Invite } from 'discord.js';
import { log } from '../logger.js';
import { api, ApiError } from '../api-client.js';

// Per-guild snapshot of invite codes → current `uses` count. We refresh the
// snapshot on join and diff against the pre-join state to identify which
// invite the new member used (the one whose `uses` went up by 1, or the only
// new entry if Discord created a single-use invite that vanished). Vanity URL
// (guild.vanityURLCode) is tracked specially with the constant `__vanity__`
// pseudo-code since it isn't returned by guild.invites.fetch().
const cache = new Map<string, Map<string, number>>();

const VANITY_CODE = '__vanity__';

function snapshotFromInvites(invites: ReadonlyMap<string, Invite>): Map<string, number> {
  const out = new Map<string, number>();
  for (const inv of invites.values()) {
    out.set(inv.code, inv.uses ?? 0);
  }
  return out;
}

function describeInvite(inv: Invite) {
  return {
    code: inv.code,
    inviterId: inv.inviter?.id ?? null,
    channelId: inv.channel?.id ?? null,
    maxUses: inv.maxUses ?? null,
    uses: inv.uses ?? 0,
    expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
  };
}

// Fetch the current invite list from Discord, update the local cache, and
// push the latest counts up to the API so the dashboard stays in sync.
// Returns the post-fetch snapshot so callers can diff against the prior one.
export async function refreshGuildInvites(guild: Guild): Promise<Map<string, number>> {
  try {
    const invites = await guild.invites.fetch();
    const snapshot = snapshotFromInvites(invites);
    cache.set(guild.id, snapshot);

    // Best-effort: keep the API mirror of invite codes up to date. We do this
    // serially with a short circuit on the first auth-style error so a
    // misconfigured guild doesn't spam.
    for (const inv of invites.values()) {
      const d = describeInvite(inv);
      try {
        await api.upsertInvite(guild.id, {
          code: d.code,
          inviterId: d.inviterId,
          channelId: d.channelId,
          maxUses: d.maxUses,
          uses: d.uses,
          expiresAt: d.expiresAt,
        });
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) break;
        log.warn('invite-cache: upsertInvite failed', {
          guildId: guild.id,
          code: d.code,
          err: String(err),
        });
      }
    }
    return snapshot;
  } catch (err) {
    log.warn('invite-cache: guild.invites.fetch failed', {
      guildId: guild.id,
      err: String(err),
    });
    return cache.get(guild.id) ?? new Map();
  }
}

export interface InviteDiffResult {
  code: string;
  inviterId: string | null;
  channelId: string | null;
}

// Compare the cached snapshot against a fresh fetch and return the invite
// whose `uses` grew (or appeared at uses>0). Returns null if we can't tell.
export async function diffOnJoin(guild: Guild): Promise<InviteDiffResult | null> {
  const before = cache.get(guild.id) ?? new Map<string, number>();

  let invites: ReadonlyMap<string, Invite>;
  try {
    invites = await guild.invites.fetch();
  } catch (err) {
    log.warn('invite-cache: diff fetch failed', { guildId: guild.id, err: String(err) });
    return null;
  }
  const after = snapshotFromInvites(invites);

  let matchCode: string | null = null;
  for (const [code, uses] of after.entries()) {
    const prev = before.get(code) ?? 0;
    if (uses > prev) {
      matchCode = code;
      break;
    }
  }

  // Detect a code that disappeared (single-use, exhausted) — if exactly one
  // entry in `before` is no longer in `after`, that's our culprit.
  if (!matchCode) {
    const vanished: string[] = [];
    for (const code of before.keys()) {
      if (!after.has(code)) vanished.push(code);
    }
    if (vanished.length === 1) matchCode = vanished[0] ?? null;
  }

  // Fall back to vanity URL if the guild has one and we found nothing.
  if (!matchCode && guild.vanityURLCode) {
    matchCode = guild.vanityURLCode;
  }

  // Replace cache with the post-join snapshot.
  cache.set(guild.id, after);

  if (!matchCode) return null;

  const inv = invites.get(matchCode);
  // For vanity URLs, the inviter is the guild itself — no row in fetch().
  if (!inv) {
    return {
      code: matchCode,
      inviterId: null,
      channelId: null,
    };
  }

  // Sync the matched invite up to the API.
  try {
    const d = describeInvite(inv);
    await api.upsertInvite(guild.id, {
      code: d.code,
      inviterId: d.inviterId,
      channelId: d.channelId,
      maxUses: d.maxUses,
      uses: d.uses,
      expiresAt: d.expiresAt,
    });
  } catch (err) {
    log.warn('invite-cache: post-diff upsert failed', {
      guildId: guild.id,
      code: matchCode,
      err: String(err),
    });
  }

  return {
    code: inv.code,
    inviterId: inv.inviter?.id ?? null,
    channelId: inv.channel?.id ?? null,
  };
}

// Drop our cached entry for a code (called from InviteDelete).
export function dropInviteFromCache(guildId: string, code: string): void {
  const m = cache.get(guildId);
  if (m) m.delete(code);
}

// Record an invite (called from InviteCreate).
export function addInviteToCache(guildId: string, code: string, uses: number): void {
  let m = cache.get(guildId);
  if (!m) {
    m = new Map();
    cache.set(guildId, m);
  }
  m.set(code, uses);
}

// Used by tests / the InviteDelete handler to confirm the constant.
export const INVITE_VANITY_CODE = VANITY_CODE;
