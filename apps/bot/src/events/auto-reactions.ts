import { Events, type Client } from 'discord.js';
import type { AutoReactionRule } from '@discord-bot/shared';
import { log } from '../logger.js';
import { getAutoReactionRules } from '../util/auto-reaction-cache.js';

// Discord's custom-emoji token format is `<:name:id>` or `<a:name:id>` for
// animated. message.react() accepts the raw unicode glyph, the numeric id of a
// guild emoji, or an Emoji resolvable. To stay robust to either input shape we
// extract the id from a `<:name:id>` token; otherwise we pass through.
const CUSTOM_EMOJI_RE = /^<a?:[A-Za-z0-9_]+:(\d{17,20})>$/;

function normaliseEmoji(raw: string): string {
  const m = CUSTOM_EMOJI_RE.exec(raw);
  if (m && m[1]) return m[1];
  return raw;
}

function ruleMatches(content: string, rule: AutoReactionRule): boolean {
  if (rule.isRegex) {
    try {
      const re = new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i');
      return re.test(content);
    } catch {
      return false;
    }
  }
  const haystack = rule.caseSensitive ? content : content.toLowerCase();
  const needle = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();
  return haystack.includes(needle);
}

export function registerAutoReactionEvents(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || !message.guildId) return;
    if (message.author.bot) return;
    if (!message.content) return;

    const rules = await getAutoReactionRules(message.guildId);
    if (rules.length === 0) return;

    for (const rule of rules) {
      if (rule.channelId && rule.channelId !== message.channelId) continue;
      if (!ruleMatches(message.content, rule)) continue;

      // React with each emoji in order. We await between reactions so we
      // respect Discord's per-message rate limit on adding reactions (and so
      // the order is preserved). Each reaction is independently try/caught so
      // one bad emoji can't stop the rest of the rule's reactions.
      for (const raw of rule.emojis) {
        const emoji = normaliseEmoji(raw);
        try {
          await message.react(emoji);
        } catch (err) {
          log.warn('Auto-reaction react failed', {
            guildId: message.guildId,
            ruleId: rule.id,
            emoji: raw,
            err: String(err),
          });
        }
      }
    }
  });
}
