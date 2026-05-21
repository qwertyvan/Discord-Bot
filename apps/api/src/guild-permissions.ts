import { hasManageGuild } from '@discord-bot/shared';
import { getUserGuilds, guildIconUrl, type DiscordPartialGuild } from './discord.js';

interface CacheEntry {
  fetchedAt: number;
  guilds: DiscordPartialGuild[];
}

const CACHE_TTL_MS = 60_000; // 1 minute
const CACHE_MAX_ENTRIES = 1000;
// JS Map iteration order is insertion order, so we evict the oldest entry
// when over capacity. Simple LRU-ish behaviour; good enough for this scale.
const cache = new Map<string, CacheEntry>();

export async function getManageableGuilds(
  userId: string,
  accessToken: string,
): Promise<DiscordPartialGuild[]> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    // Refresh recency by re-inserting.
    cache.delete(userId);
    cache.set(userId, cached);
    return cached.guilds.filter((g) => hasManageGuild(g.permissions));
  }

  const all = await getUserGuilds(accessToken);
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(userId, { fetchedAt: Date.now(), guilds: all });
  return all.filter((g) => hasManageGuild(g.permissions));
}

export function invalidatePermissionsCache(userId: string): void {
  cache.delete(userId);
}

export { guildIconUrl };
