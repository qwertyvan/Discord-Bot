import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

interface Bucket {
  guildId: string;
  day: string; // YYYY-MM-DD (UTC)
  joins: number;
  leaves: number;
  messages: number;
  voiceMinutes: number;
  channelMessages: Map<string, number>;
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function keyFor(guildId: string, day: string): string {
  return `${guildId}|${day}`;
}

/**
 * In-memory accumulator for join/leave/message/voice counts keyed by
 * (guildId, UTC-day). `flushAll` snapshots the dirty buckets, clears them,
 * and POSTs to the API — dropping a flush on failure is acceptable.
 */
class ActivityBatcher {
  private readonly buckets = new Map<string, Bucket>();

  private bucket(guildId: string): Bucket {
    const day = utcDayKey();
    const id = keyFor(guildId, day);
    let b = this.buckets.get(id);
    if (!b) {
      b = {
        guildId,
        day,
        joins: 0,
        leaves: 0,
        messages: 0,
        voiceMinutes: 0,
        channelMessages: new Map<string, number>(),
      };
      this.buckets.set(id, b);
    }
    return b;
  }

  recordMessage(guildId: string, channelId: string): void {
    const b = this.bucket(guildId);
    b.messages += 1;
    b.channelMessages.set(channelId, (b.channelMessages.get(channelId) ?? 0) + 1);
  }

  recordJoin(guildId: string): void {
    this.bucket(guildId).joins += 1;
  }

  recordLeave(guildId: string): void {
    this.bucket(guildId).leaves += 1;
  }

  recordVoiceMinute(guildId: string, count: number): void {
    if (count <= 0) return;
    this.bucket(guildId).voiceMinutes += count;
  }

  async flushAll(): Promise<void> {
    if (this.buckets.size === 0) return;
    const snapshot = [...this.buckets.values()];
    this.buckets.clear();

    for (const b of snapshot) {
      const channelMessages = [...b.channelMessages.entries()].map(([channelId, count]) => ({
        channelId,
        count,
      }));
      const hasActivity =
        b.joins > 0 ||
        b.leaves > 0 ||
        b.messages > 0 ||
        b.voiceMinutes > 0 ||
        channelMessages.length > 0;
      if (!hasActivity) continue;
      try {
        await api.postActivityBatch(b.guildId, {
          day: b.day,
          ...(b.joins > 0 ? { joins: b.joins } : {}),
          ...(b.leaves > 0 ? { leaves: b.leaves } : {}),
          ...(b.messages > 0 ? { messages: b.messages } : {}),
          ...(b.voiceMinutes > 0 ? { voiceMinutes: b.voiceMinutes } : {}),
          channelMessages,
        });
      } catch (err) {
        if (err instanceof ApiError) {
          log.warn('postActivityBatch failed', { guildId: b.guildId, status: err.status });
        } else {
          log.warn('postActivityBatch error', { guildId: b.guildId, err: String(err) });
        }
        // Drop the batch — losing a minute of counts is acceptable.
      }
    }
  }
}

export const activityBatcher = new ActivityBatcher();
