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

async function maybeDeleteEmptyChild(
  guildId: string,
  channel: VoiceBasedChannel,
): Promise<void> {
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
  });
}
