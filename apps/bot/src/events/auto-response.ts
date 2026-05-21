import { Events, type Client } from 'discord.js';
import { log } from '../logger.js';
import { getAutoResponses } from '../util/autoresponse-cache.js';

const WORD_BOUNDARY = /\W/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matches(content: string, trigger: string, matchType: string, caseSensitive: boolean): boolean {
  const haystack = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? trigger : trigger.toLowerCase();
  if (matchType === 'exact') return haystack === needle;
  if (matchType === 'word') {
    const re = new RegExp(`\\b${escapeRegex(needle)}\\b`, caseSensitive ? '' : 'i');
    return re.test(content);
  }
  return haystack.includes(needle);
}

export function registerAutoResponseEvents(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || !message.guildId) return;
    if (message.author.bot) return;
    if (!message.content) return;

    const items = await getAutoResponses(message.guildId);
    for (const ar of items) {
      if (!ar.enabled) continue;
      if (matches(message.content, ar.trigger, ar.matchType, ar.caseSensitive)) {
        await message.reply({ content: ar.response, allowedMentions: { parse: [] } }).catch((err) => {
          log.warn('Auto-response reply failed', { guildId: message.guildId, err: String(err) });
        });
        // First-match-wins to avoid noisy double-replies.
        return;
      }
      // ignore boundary detail; helper used in caseInsensitive substring path
      void WORD_BOUNDARY;
    }
  });
}
