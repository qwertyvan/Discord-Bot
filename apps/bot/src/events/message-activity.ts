import { Events, type Client, type VoiceState } from 'discord.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

interface BucketKey {
  guildId: string;
  channelId: string;
  date: string; // YYYY-MM-DD (UTC)
  hour: number;
}

const FLUSH_MS = 60_000;
const buckets = new Map<string, BucketKey & { count: number }>();

// Per-(guild, user) deltas for activity-role rules and inactivity pruning.
// Keyed by `${guildId}|${userId}`. `touch` is set whenever we want to bump
// lastActiveAt regardless of counter deltas (e.g. presence-only updates).
interface MemberBucket {
  guildId: string;
  userId: string;
  messages: number;
  voiceMinutes: number;
  touch: boolean;
}
const memberBuckets = new Map<string, MemberBucket>();

// Open voice sessions so we can attribute join→leave intervals as
// voice-minute deltas at leave time.
interface VoiceSession {
  joinedAt: number;
}
const voiceSessions = new Map<string, VoiceSession>(); // key: `${guildId}:${userId}`

function keyFor(k: BucketKey): string {
  return `${k.guildId}|${k.channelId}|${k.date}|${k.hour}`;
}

function memberKey(guildId: string, userId: string): string {
  return `${guildId}|${userId}`;
}

function bumpMember(
  guildId: string,
  userId: string,
  patch: Partial<Pick<MemberBucket, 'messages' | 'voiceMinutes' | 'touch'>>,
): void {
  const id = memberKey(guildId, userId);
  const existing = memberBuckets.get(id);
  if (existing) {
    if (patch.messages) existing.messages += patch.messages;
    if (patch.voiceMinutes) existing.voiceMinutes += patch.voiceMinutes;
    if (patch.touch) existing.touch = true;
    return;
  }
  memberBuckets.set(id, {
    guildId,
    userId,
    messages: patch.messages ?? 0,
    voiceMinutes: patch.voiceMinutes ?? 0,
    touch: patch.touch ?? false,
  });
}

export function registerMessageActivityEvents(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (!message.inGuild() || message.author.bot || !message.guildId) return;
    const now = new Date();
    const key: BucketKey = {
      guildId: message.guildId,
      channelId: message.channelId,
      date: now.toISOString().slice(0, 10),
      hour: now.getUTCHours(),
    };
    const id = keyFor(key);
    const existing = buckets.get(id);
    if (existing) existing.count++;
    else buckets.set(id, { ...key, count: 1 });

    bumpMember(message.guildId, message.author.id, { messages: 1, touch: true });
  });

  client.on(Events.VoiceStateUpdate, (oldState: VoiceState, newState: VoiceState) => {
    if (!newState.guild) return;
    const guildId = newState.guild.id;
    const userId = newState.id;
    const key = `${guildId}:${userId}`;

    // Join: start a session.
    if (!oldState.channelId && newState.channelId) {
      voiceSessions.set(key, { joinedAt: Date.now() });
      return;
    }

    // Leave: attribute elapsed minutes to the member bucket.
    if (oldState.channelId && !newState.channelId) {
      const session = voiceSessions.get(key);
      voiceSessions.delete(key);
      if (!session) return;
      const minutes = Math.floor((Date.now() - session.joinedAt) / 60_000);
      if (minutes >= 1) {
        bumpMember(guildId, userId, { voiceMinutes: minutes, touch: true });
      }
    }
  });

  setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_MS);
}

async function flush(): Promise<void> {
  await Promise.all([flushChannelBuckets(), flushMemberBuckets()]);
}

async function flushChannelBuckets(): Promise<void> {
  if (buckets.size === 0) return;
  // Snapshot then clear so concurrent increments don't get lost.
  const snapshot = [...buckets.values()];
  buckets.clear();

  // Group by guildId.
  const byGuild = new Map<string, Array<{ channelId: string; date: string; hour: number; count: number }>>();
  for (const b of snapshot) {
    const list = byGuild.get(b.guildId) ?? [];
    list.push({ channelId: b.channelId, date: b.date, hour: b.hour, count: b.count });
    byGuild.set(b.guildId, list);
  }

  for (const [guildId, entries] of byGuild) {
    // Batch up to 500 per request.
    for (let i = 0; i < entries.length; i += 500) {
      const slice = entries.slice(i, i + 500);
      try {
        await api.flushMessageActivity(guildId, slice);
      } catch (err) {
        if (err instanceof ApiError) {
          log.warn('flushMessageActivity failed', { guildId, status: err.status });
        } else {
          log.warn('flushMessageActivity error', { guildId, err: String(err) });
        }
        // On failure, drop the batch — losing a minute of counts is acceptable.
      }
    }
  }
}

async function flushMemberBuckets(): Promise<void> {
  if (memberBuckets.size === 0) return;
  const snapshot = [...memberBuckets.values()];
  memberBuckets.clear();

  const byGuild = new Map<string, MemberBucket[]>();
  for (const b of snapshot) {
    const list = byGuild.get(b.guildId) ?? [];
    list.push(b);
    byGuild.set(b.guildId, list);
  }

  for (const [guildId, entries] of byGuild) {
    for (let i = 0; i < entries.length; i += 500) {
      const slice = entries.slice(i, i + 500).map((b) => ({
        userId: b.userId,
        ...(b.messages > 0 ? { messages: b.messages } : {}),
        ...(b.voiceMinutes > 0 ? { voiceMinutes: b.voiceMinutes } : {}),
        ...(b.touch ? { touch: true } : {}),
      }));
      try {
        await api.postMemberActivityBatch(guildId, slice);
      } catch (err) {
        if (err instanceof ApiError) {
          log.warn('postMemberActivityBatch failed', { guildId, status: err.status });
        } else {
          log.warn('postMemberActivityBatch error', { guildId, err: String(err) });
        }
        // Drop the batch on failure; counters resume cleanly next tick.
      }
    }
  }
}
