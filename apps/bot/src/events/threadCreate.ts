import { ChannelType, Events, type Client } from 'discord.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

interface RuleCacheEntry {
  fetchedAt: number;
  rules: Array<{ keyword: string; tagId: string }>;
}

const TTL_MS = 5 * 60_000;
// Cache per (guildId, channelId) — the parent forum channel id.
const ruleCache = new Map<string, RuleCacheEntry>();

async function getRulesForChannel(
  guildId: string,
  parentChannelId: string,
): Promise<Array<{ keyword: string; tagId: string }>> {
  const key = `${guildId}:${parentChannelId}`;
  const cached = ruleCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.rules;
  try {
    const { tags } = await api.listForumTags(guildId);
    const filtered = tags
      .filter((t) => t.channelId === parentChannelId)
      .map((t) => ({ keyword: t.keyword.toLowerCase(), tagId: t.tagId }));
    ruleCache.set(key, { fetchedAt: Date.now(), rules: filtered });
    return filtered;
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      log.warn('Forum auto-tag fetch failed', { guildId, parentChannelId, err: String(err) });
    }
    ruleCache.set(key, { fetchedAt: Date.now(), rules: [] });
    return [];
  }
}

export function invalidateForumTagCache(guildId: string, parentChannelId: string): void {
  ruleCache.delete(`${guildId}:${parentChannelId}`);
}

/**
 * Apply matching forum auto-tag rules to newly-created forum threads. We
 * scan the first message body (lower-cased) and combine each matching rule's
 * tagId with the thread's existing applied tags.
 */
export function registerThreadCreate(client: Client): void {
  client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
    if (!newlyCreated) return;
    if (!thread.guildId) return;
    const parent = thread.parent;
    if (!parent || parent.type !== ChannelType.GuildForum) return;

    const rules = await getRulesForChannel(thread.guildId, parent.id);
    if (rules.length === 0) return;

    try {
      // Forum threads have a starter message that matches the thread id.
      const starter = await thread.fetchStarterMessage().catch(() => null);
      if (!starter) return;
      const haystack = starter.content.toLowerCase();
      const matched = new Set<string>(thread.appliedTags);
      let added = false;
      for (const rule of rules) {
        if (haystack.includes(rule.keyword) && !matched.has(rule.tagId)) {
          matched.add(rule.tagId);
          added = true;
        }
      }
      if (!added) return;
      // Discord limits applied tags to 5 per thread.
      const next = [...matched].slice(0, 5);
      await thread.setAppliedTags(next, 'Forum auto-tag rules');
    } catch (err) {
      log.warn('Forum auto-tag apply failed', {
        guildId: thread.guildId,
        threadId: thread.id,
        err: String(err),
      });
    }
  });
}
