import type { Message } from 'discord.js';
import type { AutomodRules } from '@discord-bot/shared';

export interface RuleHit {
  rule: string;
  reason: string;
  payload?: Record<string, unknown>;
}

const DISCORD_INVITE = /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/([a-z0-9-]+)/gi;
const URL_PATTERN = /https?:\/\/([^\s/?#]+)[^\s]*/gi;
const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const UNICODE_EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
// Unicode "Mark" general category — combining characters used for zalgo.
const COMBINING_MARKS = /\p{M}/gu;

function extractDomains(text: string): string[] {
  const domains: string[] = [];
  const matches = text.matchAll(URL_PATTERN);
  for (const m of matches) {
    if (m[1]) domains.push(m[1].toLowerCase());
  }
  return domains;
}

function matchesDomain(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

export interface AntispamTracker {
  // Per-(guild,user) message timestamps within the active window.
  buckets: Map<string, number[]>;
  /**
   * Record a message and return whether the user crossed the threshold.
   */
  record(guildId: string, userId: string, windowSeconds: number, threshold: number): boolean;
}

export function createAntispamTracker(): AntispamTracker {
  const buckets = new Map<string, number[]>();
  return {
    buckets,
    record(guildId, userId, windowSeconds, threshold) {
      const key = `${guildId}:${userId}`;
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const bucket = (buckets.get(key) ?? []).filter((t) => now - t <= windowMs);
      bucket.push(now);
      buckets.set(key, bucket);
      return bucket.length >= threshold;
    },
  };
}

/**
 * Run every enabled per-message rule against a message and return the first
 * violation, or null. Order matters: cheaper checks first.
 */
export function evaluateMessageRules(
  message: Message,
  rules: AutomodRules,
  antispam: AntispamTracker,
): RuleHit | null {
  const text = message.content ?? '';

  if (rules.antispam?.enabled && !message.author.bot) {
    const r = rules.antispam;
    if (antispam.record(message.guildId!, message.author.id, r.windowSeconds, r.threshold)) {
      return {
        rule: 'antispam',
        reason: `Sent ≥ ${r.threshold} messages within ${r.windowSeconds}s.`,
      };
    }
  }

  if (rules.massmention?.enabled) {
    const total = message.mentions.users.size + message.mentions.roles.size;
    if (total >= rules.massmention.threshold) {
      return {
        rule: 'massmention',
        reason: `Mass mention: ${total} mentions ≥ threshold ${rules.massmention.threshold}.`,
        payload: { total },
      };
    }
  }

  if (rules.caps?.enabled && text.length >= rules.caps.minLength) {
    const letters = text.match(/[A-Za-z]/g) ?? [];
    if (letters.length >= rules.caps.minLength) {
      const upper = text.match(/[A-Z]/g) ?? [];
      const ratio = upper.length / letters.length;
      if (ratio >= rules.caps.threshold) {
        return {
          rule: 'caps',
          reason: `Caps ratio ${(ratio * 100).toFixed(0)}% ≥ ${(rules.caps.threshold * 100).toFixed(0)}%.`,
          payload: { ratio },
        };
      }
    }
  }

  if (rules.emojispam?.enabled) {
    const customCount = (text.match(CUSTOM_EMOJI) ?? []).length;
    const unicodeCount = (text.match(UNICODE_EMOJI) ?? []).length;
    const total = customCount + unicodeCount;
    if (total >= rules.emojispam.threshold) {
      return {
        rule: 'emojispam',
        reason: `Emoji spam: ${total} emoji ≥ threshold ${rules.emojispam.threshold}.`,
        payload: { total },
      };
    }
  }

  if (rules.zalgo?.enabled && text.length > 0) {
    const marks = (text.match(COMBINING_MARKS) ?? []).length;
    const ratio = marks / text.length;
    if (ratio >= rules.zalgo.threshold) {
      return {
        rule: 'zalgo',
        reason: `Zalgo content detected (${(ratio * 100).toFixed(0)}% combining marks).`,
        payload: { ratio },
      };
    }
  }

  if (rules.badwords?.enabled && rules.badwords.words.length > 0) {
    const lower = text.toLowerCase();
    for (const word of rules.badwords.words) {
      const w = word.toLowerCase();
      if (rules.badwords.matchSubstring ? lower.includes(w) : new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(text)) {
        return {
          rule: 'badwords',
          reason: `Contains blocked word "${word}".`,
          payload: { word },
        };
      }
    }
  }

  if (rules.antiinvite?.enabled) {
    const matches = [...text.matchAll(DISCORD_INVITE)].map((m) => m[1]);
    if (matches.length > 0) {
      // The allow-list is by guild ID; we can't resolve invite → guild without an
      // HTTP call here, so we always treat invites as violations and rely on the
      // exempt-roles feature for staff who post their own invites.
      void rules.antiinvite.allowedGuildIds;
      return {
        rule: 'antiinvite',
        reason: `Discord invite link detected (${matches.length}).`,
        payload: { invites: matches },
      };
    }
  }

  const domains = extractDomains(text);

  if (rules.links?.enabled && domains.length > 0) {
    const list = rules.links.domains.map((d) => d.toLowerCase());
    for (const d of domains) {
      const matched = list.some((entry) => matchesDomain(d, entry));
      const violates = rules.links.mode === 'block' ? matched : !matched;
      if (violates) {
        return {
          rule: 'links',
          reason:
            rules.links.mode === 'block'
              ? `Link to blocked domain "${d}".`
              : `Link to non-allowed domain "${d}".`,
          payload: { domain: d },
        };
      }
    }
  }

  if (rules.phishing?.enabled && domains.length > 0) {
    const list = rules.phishing.staticDomains.map((d) => d.toLowerCase());
    for (const d of domains) {
      if (list.some((entry) => matchesDomain(d, entry))) {
        return {
          rule: 'phishing',
          reason: `Known phishing domain "${d}".`,
          payload: { domain: d },
        };
      }
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
