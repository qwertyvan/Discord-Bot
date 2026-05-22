import {
  ChannelType,
  Events,
  PermissionFlagsBits,
  type CategoryChannel,
  type Client,
  type VoiceBasedChannel,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';
import type { VoiceHubChannel } from '@discord-bot/shared';
import {
  VOICE_CLAIM_GRACE_MS,
  cancelPendingRelease,
  schedulePendingRelease,
} from '../util/voice-claim-state.js';

// Per-guild cache of configured voice hubs. Invalidated on hub create/delete
// via `invalidateVoiceHubCache`. TTL keeps stale entries from lingering
// across slash-command tweaks made elsewhere.
interface HubCache {
  fetchedAt: number;
  hubs: VoiceHubChannel[];
}
const HUB_TTL_MS = 60_000;
const hubsByGuild = new Map<string, HubCache>();

// Child channels we spawned, keyed by guildId. Used to know which channels
// are safe to auto-delete when they empty out.
const spawnedByGuild = new Map<string, Set<string>>();

// Map (guildId:userId) → current voice-session id. Lets us close the right
// session when the user leaves or moves.
const sessionByMember = new Map<string, string>();

function memberKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

async function getHubs(guildId: string): Promise<VoiceHubChannel[]> {
  const cached = hubsByGuild.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < HUB_TTL_MS) return cached.hubs;
  try {
    const { hubs } = await api.listVoiceHubs(guildId);
    hubsByGuild.set(guildId, { fetchedAt: Date.now(), hubs });
    return hubs;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) {
      log.warn('listVoiceHubs failed', { guildId, err: String(err) });
    }
    hubsByGuild.set(guildId, { fetchedAt: Date.now(), hubs: [] });
    return [];
  }
}

export function invalidateVoiceHubCache(guildId: string): void {
  hubsByGuild.delete(guildId);
}

function renderChannelName(pattern: string, username: string): string {
  return pattern.replaceAll('{username}', username).slice(0, 100);
}

async function spawnChildChannel(
  hub: VoiceHubChannel,
  state: VoiceState,
): Promise<VoiceChannel | null> {
  if (!state.member || !state.guild) return null;
  const guild = state.guild;
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;

  // Resolve the category: explicit hub.categoryId wins; else inherit from the
  // hub channel's parent.
  let parent: CategoryChannel | null = null;
  if (hub.categoryId) {
    const cat = guild.channels.cache.get(hub.categoryId);
    if (cat && cat.type === ChannelType.GuildCategory) parent = cat;
  }
  if (!parent) {
    const hubChannel = guild.channels.cache.get(hub.channelId);
    if (hubChannel && 'parent' in hubChannel) {
      const hubParent = hubChannel.parent;
      if (hubParent && hubParent.type === ChannelType.GuildCategory) {
        parent = hubParent;
      }
    }
  }

  const name = renderChannelName(hub.namePattern, state.member.displayName);
  try {
    const child = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      ...(parent ? { parent: parent.id } : {}),
      ...(hub.userLimit !== null && hub.userLimit !== undefined
        ? { userLimit: hub.userLimit }
        : {}),
      reason: `Voice hub spawn for ${state.member.user.tag}`,
    });
    return child;
  } catch (err) {
    log.warn('Voice hub child create failed', {
      guildId: guild.id,
      hubId: hub.channelId,
      err: String(err),
    });
    return null;
  }
}

async function maybeDeleteEmptyChild(guildId: string, channel: VoiceBasedChannel): Promise<void> {
  const spawned = spawnedByGuild.get(guildId);
  if (!spawned || !spawned.has(channel.id)) return;
  // Only delete when truly empty of humans+bots so we don't race a fresh join.
  if (channel.members.size > 0) return;
  try {
    await channel.delete('Voice hub auto-delete: empty');
    spawned.delete(channel.id);
  } catch (err) {
    log.warn('Voice hub child delete failed', {
      guildId,
      channelId: channel.id,
      err: String(err),
    });
  }
}

export function registerVoiceStateEvents(client: Client): void {
  client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;
    const guildId = guild.id;
    const userId = newState.id;
    const key = memberKey(guildId, userId);

    // ─── Track join/move/leave for voice-session records ───────────────
    const oldChan = oldState.channelId;
    const newChan = newState.channelId;

    // Close any prior session whenever the channel changes or the user leaves.
    if (oldChan && oldChan !== newChan) {
      const sessionId = sessionByMember.get(key);
      if (sessionId) {
        sessionByMember.delete(key);
        api.endVoiceSession(guildId, sessionId).catch((err) => {
          log.warn('endVoiceSession failed', { guildId, sessionId, err: String(err) });
        });
      }
    }

    // Open a session whenever the user enters a (new) channel.
    if (newChan && newChan !== oldChan && !newState.member?.user.bot) {
      try {
        const session = await api.startVoiceSession(guildId, {
          userId,
          channelId: newChan,
        });
        sessionByMember.set(key, session.id);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) {
          log.warn('startVoiceSession failed', { guildId, userId, err: String(err) });
        }
      }
    }

    // ─── Hub: spawn a child channel and move the user in ───────────────
    if (newChan && newChan !== oldChan && !newState.member?.user.bot) {
      const hubs = await getHubs(guildId);
      const hub = hubs.find((h) => h.channelId === newChan);
      if (hub && newState.member) {
        const child = await spawnChildChannel(hub, newState);
        if (child) {
          const set = spawnedByGuild.get(guildId) ?? new Set<string>();
          set.add(child.id);
          spawnedByGuild.set(guildId, set);
          try {
            await newState.member.voice.setChannel(child, 'Moved into voice hub child');
          } catch (err) {
            log.warn('Voice hub member move failed', {
              guildId,
              userId,
              err: String(err),
            });
            // Roll back the spawn so we don't leave an orphan channel behind.
            await child.delete('Voice hub move failed').catch(() => {});
            set.delete(child.id);
          }
        }
      }
    }

    // ─── Auto-delete: if leaving/moving out of a spawned child, sweep ──
    if (oldChan && oldChan !== newChan) {
      const oldChannel = oldState.channel;
      if (oldChannel && oldChannel.isVoiceBased()) {
        await maybeDeleteEmptyChild(guildId, oldChannel);
      }
    }

    // ─── Voice-claim ownership maintenance ─────────────────────────────
    // Owner returned to their claimed channel: cancel any pending release.
    if (newChan && newChan === oldChan) return; // no transition
    await handleVoiceClaimTransition(guildId, userId, oldChan, newChan, oldState);
  });
}

// Track per-channel known claims to avoid hitting the API on every transition.
// Keyed by `${guildId}:${channelId}` → ownerId. Refreshed on demand.
const claimOwnerCache = new Map<string, string | null>();
const CLAIM_TTL_MS = 30_000;
const claimCacheFetchedAt = new Map<string, number>();

function claimKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

async function getClaimOwner(guildId: string, channelId: string): Promise<string | null> {
  const k = claimKey(guildId, channelId);
  const fetched = claimCacheFetchedAt.get(k);
  if (fetched && Date.now() - fetched < CLAIM_TTL_MS) {
    return claimOwnerCache.get(k) ?? null;
  }
  try {
    const { claims } = await api.listVoiceClaims(guildId);
    for (const c of claims) {
      claimOwnerCache.set(claimKey(guildId, c.channelId), c.ownerId);
      claimCacheFetchedAt.set(claimKey(guildId, c.channelId), Date.now());
    }
    // Mark this specific (guild, channel) as fetched even if no row exists.
    if (!claimCacheFetchedAt.has(k)) {
      claimOwnerCache.set(k, null);
      claimCacheFetchedAt.set(k, Date.now());
    }
    return claimOwnerCache.get(k) ?? null;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) {
      log.warn('listVoiceClaims failed', { guildId, err: String(err) });
    }
    return null;
  }
}

function invalidateClaimCache(guildId: string, channelId: string): void {
  const k = claimKey(guildId, channelId);
  claimOwnerCache.delete(k);
  claimCacheFetchedAt.delete(k);
}

/** Public hook so the /vc command can keep the in-process cache fresh. */
export function noteVoiceClaimMutation(guildId: string, channelId: string): void {
  invalidateClaimCache(guildId, channelId);
}

async function releaseClaim(guildId: string, channelId: string): Promise<void> {
  invalidateClaimCache(guildId, channelId);
  try {
    await api.deleteVoiceClaim(guildId, channelId);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) {
      log.warn('voice claim release failed', { guildId, channelId, err: String(err) });
    }
  }
}

async function handleVoiceClaimTransition(
  guildId: string,
  userId: string,
  oldChan: string | null,
  newChan: string | null,
  oldState: VoiceState,
): Promise<void> {
  // Owner left a claimed channel.
  if (oldChan && oldChan !== newChan) {
    const ownerId = await getClaimOwner(guildId, oldChan);
    if (ownerId === userId) {
      const channel = oldState.channel;
      // If the channel is now empty, release immediately. The bot itself can
      // be present (we sometimes connect for TTS/music), so count humans only.
      const humansLeft =
        channel && channel.isVoiceBased() ? channel.members.filter((m) => !m.user.bot).size : 0;
      if (humansLeft === 0) {
        await releaseClaim(guildId, oldChan);
      } else {
        // Schedule a 60s grace release; cancelled if the owner returns.
        schedulePendingRelease(guildId, oldChan, VOICE_CLAIM_GRACE_MS, async () => {
          // Double-check the owner hasn't returned by the time the timer fires.
          const current = oldState.guild?.channels.cache.get(oldChan);
          if (current && current.isVoiceBased()) {
            const stillHere = current.members.has(userId);
            if (stillHere) return; // owner came back via a route we didn't see
          }
          await releaseClaim(guildId, oldChan);
        });
      }
    } else if (oldChan) {
      // Non-owner left: if the channel emptied of humans, also release.
      const channel = oldState.channel;
      const humansLeft =
        channel && channel.isVoiceBased() ? channel.members.filter((m) => !m.user.bot).size : 0;
      if (humansLeft === 0 && ownerId) {
        cancelPendingRelease(guildId, oldChan);
        await releaseClaim(guildId, oldChan);
      }
    }
  }

  // Owner re-joined the channel they own → cancel any pending release.
  if (newChan && newChan !== oldChan) {
    const ownerId = await getClaimOwner(guildId, newChan);
    if (ownerId === userId) {
      cancelPendingRelease(guildId, newChan);
    }
  }
}
