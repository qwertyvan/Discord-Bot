import type { AutomodConfig } from '@discord-bot/shared';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

const TTL_MS = 30_000;
const cache = new Map<string, { fetchedAt: number; cfg: AutomodConfig | null }>();

export async function getAutomodConfig(guildId: string): Promise<AutomodConfig | null> {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.cfg;

  try {
    const cfg = await api.getAutomodConfig(guildId);
    cache.set(guildId, { fetchedAt: Date.now(), cfg });
    return cfg;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      cache.set(guildId, { fetchedAt: Date.now(), cfg: null });
      return null;
    }
    log.warn('Failed to fetch automod config', { guildId, err: String(err) });
    return null;
  }
}

export function invalidateAutomodCache(guildId: string): void {
  cache.delete(guildId);
}
