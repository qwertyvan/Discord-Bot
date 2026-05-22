import type { AutoReactionRule } from '@discord-bot/shared';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

const TTL_MS = 60_000;
const cache = new Map<string, { fetchedAt: number; rules: AutoReactionRule[] }>();

export async function getAutoReactionRules(guildId: string): Promise<AutoReactionRule[]> {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.rules;
  try {
    const { rules } = await api.getEnabledAutoReactionRules(guildId);
    cache.set(guildId, { fetchedAt: Date.now(), rules });
    return rules;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      cache.set(guildId, { fetchedAt: Date.now(), rules: [] });
      return [];
    }
    log.warn('Failed to fetch auto-reaction rules', { guildId, err: String(err) });
    return [];
  }
}

export function invalidateAutoReactionCache(guildId: string): void {
  cache.delete(guildId);
}
