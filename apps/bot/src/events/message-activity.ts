import { Events, type Client } from 'discord.js';
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

function keyFor(k: BucketKey): string {
  return `${k.guildId}|${k.channelId}|${k.date}|${k.hour}`;
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
  });

  setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_MS);
}

async function flush(): Promise<void> {
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
