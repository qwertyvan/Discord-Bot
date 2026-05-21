import type { LoggingConfig } from '@discord-bot/shared';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

const TTL_MS = 30_000;
const cache = new Map<string, { fetchedAt: number; cfg: LoggingConfig | null }>();

/**
 * Fetch the per-guild logging config with a short TTL cache. High-volume
 * events like messageUpdate/Delete can hit this many times per second, and
 * we don't want to hammer the API on every keystroke in busy channels.
 */
export async function getLoggingConfig(guildId: string): Promise<LoggingConfig | null> {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.cfg;

  try {
    const cfg = await api.getLoggingConfig(guildId);
    cache.set(guildId, { fetchedAt: Date.now(), cfg });
    return cfg;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      cache.set(guildId, { fetchedAt: Date.now(), cfg: null });
      return null;
    }
    log.warn('Failed to fetch logging config', { guildId, err: String(err) });
    return null;
  }
}

export function invalidateLoggingCache(guildId: string): void {
  cache.delete(guildId);
}
