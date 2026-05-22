import {
  Events,
  EmbedBuilder,
  type Client,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import type { LinkSafetyAction, LinkSafetyConfig } from '@discord-bot/shared';
import { api } from '../api-client.js';
import { log } from '../logger.js';
import { extractUrls, normalizeDomain, domainMatches } from '../util/url-extract.js';
import { resolveFinalUrl } from '../util/url-resolve.js';
import { checkSafeBrowsing } from '../util/gsb.js';
import { getLinkDomains, getLinkSafetyConfig } from '../util/link-safety-cache.js';

interface Verdict {
  decision: 'allow' | 'block';
  reason: string;
  url: string;
  finalUrl: string;
  domain: string;
}

// Evaluate one URL through the full pipeline. Used by both the live scanner
// and the `/link-safety test` ephemeral command.
export async function evaluateUrl(
  cfg: LinkSafetyConfig,
  allow: Set<string>,
  block: Set<string>,
  rawUrl: string,
): Promise<Verdict> {
  let finalUrl = rawUrl;
  if (cfg.expandShorteners) {
    finalUrl = await resolveFinalUrl(rawUrl, 3);
  }
  const domain = normalizeDomain(finalUrl);

  // Allow list wins regardless of mode when matched explicitly.
  for (const allowed of allow) {
    if (domainMatches(domain, allowed)) {
      return { decision: 'allow', reason: `allow-listed (${allowed})`, url: rawUrl, finalUrl, domain };
    }
  }

  // Local block list.
  for (const blocked of block) {
    if (domainMatches(domain, blocked)) {
      return { decision: 'block', reason: `block-listed (${blocked})`, url: rawUrl, finalUrl, domain };
    }
  }

  // Allowlist mode: anything not on the allow list is blocked.
  if (cfg.mode === 'allowlist') {
    return { decision: 'block', reason: 'not on allowlist', url: rawUrl, finalUrl, domain };
  }

  // Reputation check (optional).
  if (cfg.gsbCheck) {
    const flagged = await checkSafeBrowsing([finalUrl]);
    if (flagged.has(finalUrl)) {
      return { decision: 'block', reason: 'flagged by Google Safe Browsing', url: rawUrl, finalUrl, domain };
    }
  }

  return { decision: 'allow', reason: 'no rule matched', url: rawUrl, finalUrl, domain };
}

async function applyAction(
  message: Message,
  cfg: LinkSafetyConfig,
  action: LinkSafetyAction,
  verdict: Verdict,
): Promise<void> {
  const reason = `Link safety: ${verdict.reason} (${verdict.domain})`;
  if (action !== 'none') {
    await message.delete().catch(() => {});
  }
  const member = message.member;
  if (!member) return;
  try {
    if (action === 'warn') {
      await api.createModAction(message.guildId!, {
        type: 'WARN',
        userId: member.id,
        moderatorId: message.client.user!.id,
        reason,
      });
    } else if (action === 'mute' && member.moderatable) {
      const ms = cfg.muteMinutes * 60_000;
      await member.timeout(ms, reason);
      await api.createModAction(message.guildId!, {
        type: 'TIMEOUT',
        userId: member.id,
        moderatorId: message.client.user!.id,
        reason,
        durationMs: ms,
        expiresAt: new Date(Date.now() + ms).toISOString(),
      });
    } else if (action === 'kick' && member.kickable) {
      await member.kick(reason);
      await api.createModAction(message.guildId!, {
        type: 'KICK',
        userId: member.id,
        moderatorId: message.client.user!.id,
        reason,
      });
    }
  } catch (err) {
    log.warn('Link-safety follow-up action failed', { action, err: String(err) });
  }
}

async function notify(
  message: Message,
  cfg: LinkSafetyConfig,
  action: LinkSafetyAction,
  verdict: Verdict,
): Promise<void> {
  if (!cfg.notifyChannelId) return;
  const channel = await message.client.channels.fetch(cfg.notifyChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return;
  const embed = new EmbedBuilder()
    .setTitle('Unsafe link blocked')
    .setColor(0xed4245)
    .addFields(
      { name: 'User', value: `<@${message.author.id}>`, inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Action', value: action, inline: true },
      { name: 'Domain', value: verdict.domain || '_unknown_', inline: true },
      { name: 'Reason', value: verdict.reason, inline: false },
      ...(verdict.finalUrl !== verdict.url
        ? [{ name: 'Resolved to', value: verdict.finalUrl.slice(0, 256), inline: false }]
        : []),
    )
    .setTimestamp();
  await (channel as GuildTextBasedChannel)
    .send({ embeds: [embed], allowedMentions: { parse: [] } })
    .catch(() => {});
}

async function scanMessage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || !message.guildId) return;
  const urls = extractUrls(message.content);
  if (urls.length === 0) return;

  const cfg = await getLinkSafetyConfig(message.guildId);
  if (!cfg?.enabled) return;

  const { allow, block } = await getLinkDomains(message.guildId);

  for (const url of urls) {
    let verdict: Verdict;
    try {
      verdict = await evaluateUrl(cfg, allow, block, url);
    } catch (err) {
      log.warn('Link-safety evaluation failed', { url, err: String(err) });
      continue;
    }
    if (verdict.decision === 'allow') continue;
    const action = cfg.action as LinkSafetyAction;
    await applyAction(message, cfg, action, verdict);
    notify(message, cfg, action, verdict).catch(() => {});
    // Record into the unified automod-hit log so /automod-hits surfaces it too.
    api
      .createAutomodHit(message.guildId, {
        userId: message.author.id,
        channelId: message.channelId,
        rule: 'linksafety',
        action: action === 'none' ? 'NONE' : action === 'delete' ? 'DELETE' : action.toUpperCase(),
        reason: `${verdict.reason} (${verdict.domain})`,
        payload: { url: verdict.url, finalUrl: verdict.finalUrl, domain: verdict.domain },
      })
      .catch((err) => log.warn('Failed to record link-safety hit', { err: String(err) }));
    // Stop on first hit per message; the message is already gone for non-`none`.
    return;
  }
}

export function registerLinkSafetyEvents(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    scanMessage(message).catch((err) =>
      log.warn('Link-safety scanner failed', { err: String(err) }),
    );
  });
  client.on(Events.MessageUpdate, async (_old, newMessage) => {
    const msg = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
    if (!msg) return;
    scanMessage(msg as Message).catch((err) =>
      log.warn('Link-safety scanner failed', { err: String(err) }),
    );
  });
}
