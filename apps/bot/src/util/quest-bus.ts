import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';
import type { ProgressEvent, QuestKind } from '@discord-bot/shared';

const DEBOUNCE_MS = 5_000;
const MAX_PENDING = 50;

interface PendingEvent {
  userId: string;
  kind: QuestKind;
  channelId?: string;
  delta: number;
}

/**
 * Per-guild micro-batch of quest-progress events. Events are coalesced by
 * (userId, kind, channelId) until either:
 *   - the per-guild buffer reaches MAX_PENDING events, or
 *   - the DEBOUNCE_MS timer fires.
 * Whichever comes first, the buffer is drained and each unique event is
 * POSTed to /user-quests/progress. Failures are dropped (best-effort
 * progress; the next batch picks up where we left off).
 */
class QuestBus {
  private readonly buffers = new Map<string, Map<string, PendingEvent>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  private keyFor(userId: string, kind: QuestKind, channelId: string | undefined): string {
    return `${userId}|${kind}|${channelId ?? ''}`;
  }

  private enqueue(
    guildId: string,
    userId: string,
    kind: QuestKind,
    channelId: string | undefined,
  ): void {
    let buf = this.buffers.get(guildId);
    if (!buf) {
      buf = new Map<string, PendingEvent>();
      this.buffers.set(guildId, buf);
    }
    const key = this.keyFor(userId, kind, channelId);
    const existing = buf.get(key);
    if (existing) {
      existing.delta += 1;
    } else {
      buf.set(key, {
        userId,
        kind,
        ...(channelId !== undefined ? { channelId } : {}),
        delta: 1,
      });
    }

    if (buf.size >= MAX_PENDING) {
      // Spill immediately to avoid unbounded buffers under load.
      this.flushGuild(guildId).catch((err) =>
        log.warn('quest-bus flush failed', { guildId, err: String(err) }),
      );
      return;
    }
    this.scheduleFlush(guildId);
  }

  private scheduleFlush(guildId: string): void {
    if (this.timers.has(guildId)) return;
    const t = setTimeout(() => {
      this.timers.delete(guildId);
      this.flushGuild(guildId).catch((err) =>
        log.warn('quest-bus flush failed', { guildId, err: String(err) }),
      );
    }, DEBOUNCE_MS);
    // Allow process to exit even if flush is pending — these are best-effort.
    if (typeof t.unref === 'function') t.unref();
    this.timers.set(guildId, t);
  }

  private async flushGuild(guildId: string): Promise<void> {
    const buf = this.buffers.get(guildId);
    if (!buf || buf.size === 0) return;
    const events = [...buf.values()];
    this.buffers.delete(guildId);
    const timer = this.timers.get(guildId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(guildId);
    }

    for (const ev of events) {
      const body: ProgressEvent = {
        userId: ev.userId,
        kind: ev.kind,
        delta: ev.delta,
        ...(ev.channelId !== undefined ? { channelId: ev.channelId } : {}),
      };
      try {
        await api.postQuestProgress(guildId, body);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) continue;
        log.warn('postQuestProgress failed', {
          guildId,
          kind: ev.kind,
          status: err instanceof ApiError ? err.status : undefined,
        });
      }
    }
  }

  recordMessage(guildId: string, userId: string, channelId: string): void {
    // Two parallel objectives: count-any-message (no channel scope) and
    // channel-scoped messages — the API filters by template.targetChannelId.
    this.enqueue(guildId, userId, 'send_messages', undefined);
    this.enqueue(guildId, userId, 'send_in_channel', channelId);
  }

  recordImageMessage(guildId: string, userId: string): void {
    this.enqueue(guildId, userId, 'send_image', undefined);
  }

  recordReaction(guildId: string, userId: string, channelId: string): void {
    this.enqueue(guildId, userId, 'react_messages', channelId);
  }

  recordVoiceMinute(guildId: string, userId: string): void {
    this.enqueue(guildId, userId, 'voice_minutes', undefined);
  }

  async flushAll(): Promise<void> {
    const guildIds = [...this.buffers.keys()];
    for (const guildId of guildIds) {
      await this.flushGuild(guildId);
    }
  }
}

export const questBus = new QuestBus();
