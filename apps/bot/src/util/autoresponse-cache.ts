import type { AutoResponse } from '@discord-bot/shared';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

const TTL_MS = 60_000;
const cache = new Map<string, { fetchedAt: number; items: AutoResponse[] }>();

export async function getAutoResponses(guildId: string): Promise<AutoResponse[]> {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.items;
  try {
    const { autoResponses } = await api.listAutoResponses(guildId);
    cache.set(guildId, { fetchedAt: Date.now(), items: autoResponses });
    return autoResponses;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      cache.set(guildId, { fetchedAt: Date.now(), items: [] });
      return [];
    }
    log.warn('Failed to fetch auto-responses', { guildId, err: String(err) });
    return [];
  }
}

export function invalidateAutoResponseCache(guildId: string): void {
  cache.delete(guildId);
}
