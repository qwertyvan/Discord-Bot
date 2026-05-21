import { Events, type Client, type Guild, type GuildMember, type Message } from 'discord.js';
import type { AutomodAction, AutomodConfig } from '@discord-bot/shared';
import { api } from '../api-client.js';
import { log } from '../logger.js';
import { getAutomodConfig } from '../util/automod-cache.js';
import { createAntispamTracker, evaluateMessageRules, type RuleHit } from '../automod/rules.js';

const TIMEOUT_DEFAULT_MS = 10 * 60 * 1000;

interface RaidTrackerEntry {
  joins: number[];
  lockdownUntil: number | null;
}
const raidTracker = new Map<string, RaidTrackerEntry>();
const antispam = createAntispamTracker();

function isExempt(member: GuildMember | null, cfg: AutomodConfig, channelId: string): boolean {
  if (cfg.exemptChannelIds.includes(channelId)) return true;
  if (!member) return false;
  return member.roles.cache.some((r) => cfg.exemptRoleIds.includes(r.id));
}

async function applyAction(
  message: Message,
  hit: RuleHit,
  action: AutomodAction,
  durationMs: number | undefined,
): Promise<void> {
  const member = message.member;

  if (action !== 'NONE') {
    await message.delete().catch(() => {});
  }

  if (member) {
    try {
      if (action === 'WARN') {
        await api.createModAction(message.guildId!, {
          type: 'WARN',
          userId: member.id,
          moderatorId: message.client.user!.id,
          reason: `Automod (${hit.rule}): ${hit.reason}`,
        });
      } else if (action === 'TIMEOUT' && member.moderatable) {
        const ms = durationMs ?? TIMEOUT_DEFAULT_MS;
        await member.timeout(ms, `Automod (${hit.rule}): ${hit.reason}`);
        await api.createModAction(message.guildId!, {
          type: 'TIMEOUT',
          userId: member.id,
          moderatorId: message.client.user!.id,
          reason: `Automod (${hit.rule}): ${hit.reason}`,
          durationMs: ms,
          expiresAt: new Date(Date.now() + ms).toISOString(),
        });
      } else if (action === 'KICK' && member.kickable) {
        await member.kick(`Automod (${hit.rule}): ${hit.reason}`);
        await api.createModAction(message.guildId!, {
          type: 'KICK',
          userId: member.id,
          moderatorId: message.client.user!.id,
          reason: `Automod (${hit.rule}): ${hit.reason}`,
        });
      } else if (action === 'BAN' && member.bannable) {
        await member.ban({ reason: `Automod (${hit.rule}): ${hit.reason}` });
        await api.createModAction(message.guildId!, {
          type: 'BAN',
          userId: member.id,
          moderatorId: message.client.user!.id,
          reason: `Automod (${hit.rule}): ${hit.reason}`,
        });
      }
    } catch (err) {
      log.warn('Automod follow-up action failed', { rule: hit.rule, action, err: String(err) });
    }
  }

  api
    .createAutomodHit(message.guildId!, {
      userId: message.author.id,
      channelId: message.channelId,
      rule: hit.rule,
      action,
      reason: hit.reason,
      ...(hit.payload ? { payload: hit.payload } : {}),
    })
    .catch((err) => log.warn('Failed to record automod hit', { err: String(err) }));
}

export function registerAutomodEvents(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot || !message.guildId) return;
    const cfg = await getAutomodConfig(message.guildId);
    if (!cfg?.enabled) return;
    if (isExempt(message.member, cfg, message.channelId)) return;

    const hit =
      evaluateMessageRules(message, cfg.rules, antispam) ||
      (await evaluateAsyncRules(message, cfg.rules));
    if (!hit) return;

    const ruleCfg = (cfg.rules as Record<string, { action?: AutomodAction; durationMs?: number } | undefined>)[
      hit.rule
    ];
    const action: AutomodAction = ruleCfg?.action ?? 'DELETE';
    await applyAction(message, hit, action, ruleCfg?.durationMs);
  });

  client.on(Events.MessageUpdate, async (_, newMessage) => {
    // Edits can sneak forbidden content past automod — re-evaluate.
    const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
    if (!message || !message.inGuild() || message.author?.bot || !message.guildId) return;
    const cfg = await getAutomodConfig(message.guildId);
    if (!cfg?.enabled) return;
    if (isExempt(message.member, cfg, message.channelId)) return;
    const hit = evaluateMessageRules(message as Message, cfg.rules, antispam);
    if (!hit) return;
    const ruleCfg = (cfg.rules as Record<string, { action?: AutomodAction; durationMs?: number } | undefined>)[
      hit.rule
    ];
    const action: AutomodAction = ruleCfg?.action ?? 'DELETE';
    await applyAction(message as Message, hit, action, ruleCfg?.durationMs);
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    const cfg = await getAutomodConfig(member.guild.id);
    if (!cfg?.enabled) return;

    if (cfg.rules.newaccount?.enabled) {
      const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
      if (ageDays < cfg.rules.newaccount.ageDays) {
        await handleJoinViolation(member, 'newaccount', `Account age ${ageDays.toFixed(1)}d < ${cfg.rules.newaccount.ageDays}d.`, cfg.rules.newaccount.action);
      }
    }

    if (cfg.rules.raid?.enabled) {
      const entry = raidTracker.get(member.guild.id) ?? { joins: [], lockdownUntil: null };
      const now = Date.now();
      entry.joins = entry.joins.filter((t) => now - t <= cfg.rules.raid!.windowSeconds * 1000);
      entry.joins.push(now);
      if (entry.joins.length >= cfg.rules.raid.joinThreshold) {
        await triggerRaidLockdown(member.guild, cfg.rules.raid.joinThreshold, cfg.rules.raid.windowSeconds);
        entry.lockdownUntil = now + 30 * 60 * 1000;
        entry.joins = [];
      }
      raidTracker.set(member.guild.id, entry);
    }
  });
}

async function handleJoinViolation(
  member: GuildMember,
  rule: string,
  reason: string,
  action: AutomodAction,
): Promise<void> {
  try {
    if (action === 'KICK' && member.kickable) {
      await member.kick(`Automod (${rule}): ${reason}`);
    } else if (action === 'BAN' && member.bannable) {
      await member.ban({ reason: `Automod (${rule}): ${reason}` });
    } else if (action === 'TIMEOUT' && member.moderatable) {
      await member.timeout(TIMEOUT_DEFAULT_MS, `Automod (${rule}): ${reason}`);
    }
  } catch (err) {
    log.warn('Automod join action failed', { rule, action, err: String(err) });
  }
  api
    .createAutomodHit(member.guild.id, {
      userId: member.id,
      rule,
      action,
      reason,
    })
    .catch((err) => log.warn('Failed to record join violation', { err: String(err) }));
}

async function triggerRaidLockdown(guild: Guild, threshold: number, windowSeconds: number): Promise<void> {
  log.warn('Raid detected — locking down', { guildId: guild.id, threshold, windowSeconds });
  const everyone = guild.roles.everyone;
  let locked = 0;
  for (const channel of guild.channels.cache.values()) {
    if (!('permissionOverwrites' in channel)) continue;
    try {
      await channel.permissionOverwrites.edit(
        everyone,
        { SendMessages: false },
        { reason: 'Automod: raid lockdown' },
      );
      locked++;
    } catch {
      // ignore individual failures
    }
  }
  api
    .createAutomodHit(guild.id, {
      userId: guild.ownerId,
      rule: 'raid',
      action: 'NONE',
      reason: `Raid lockdown: ${threshold} joins within ${windowSeconds}s. Locked ${locked} channels.`,
    })
    .catch(() => {});
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|bmp)(?:\?.*)?$/i;

async function evaluateAsyncRules(
  message: Message,
  rules: AutomodConfig['rules'],
): Promise<RuleHit | null> {
  // Safe Browsing: collect URLs in content, check, hit on any match.
  if (rules.safeBrowsing?.enabled && message.content) {
    const urls = [...message.content.matchAll(URL_PATTERN)].map((m) => m[0]);
    if (urls.length > 0) {
      try {
        const { checkUrls } = await import('../integrations/safe-browsing.js');
        const flagged = await checkUrls(message.guildId!, urls);
        if (flagged.length > 0) {
          return {
            rule: 'safeBrowsing',
            reason: `URL flagged by Safe Browsing: ${flagged[0]}`,
            payload: { urls: flagged },
          };
        }
      } catch (err) {
        log.warn('Safe Browsing check failed', { err: String(err) });
      }
    }
  }

  // NSFW image: scan each image attachment.
  if (rules.nsfwImage?.enabled && message.attachments.size > 0) {
    const imageAttachments = [...message.attachments.values()].filter(
      (a) => a.url && (a.contentType?.startsWith('image/') || IMAGE_EXT.test(a.url)),
    );
    if (imageAttachments.length > 0) {
      try {
        const { classifyImage } = await import('../integrations/sightengine.js');
        for (const att of imageAttachments) {
          const result = await classifyImage(message.guildId!, att.url);
          if (result?.flagged) {
            return {
              rule: 'nsfwImage',
              reason: result.reason ?? 'NSFW image classifier flagged content.',
              payload: { url: att.url, score: result.highestScore },
            };
          }
        }
      } catch (err) {
        log.warn('NSFW image check failed', { err: String(err) });
      }
    }
  }

  return null;
}
