import {
  ChannelType,
  EmbedBuilder,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { Achievement, AchievementKind } from '@discord-bot/shared';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

// Per-(guild, kind) cache. Refresh every 60s so threshold edits propagate
// without a bot restart, but keep evaluation off the hot path otherwise.
interface CacheEntry {
  fetchedAt: number;
  achievements: Achievement[];
}
const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

// Per-(guild, user) running deltas for activity kinds whose authoritative
// totals live in MemberActivity (flushed on a ~60s timer). We add the
// in-process bump so freshly-eligible thresholds (e.g. first-message) unlock
// immediately rather than waiting for the next flush.
interface LocalDelta {
  messages: number;
  voiceMinutes: number;
}
const localDelta = new Map<string, LocalDelta>();
function deltaKey(guildId: string, userId: string): string {
  return `${guildId}|${userId}`;
}
export function bumpLocalActivity(
  guildId: string,
  userId: string,
  patch: Partial<LocalDelta>,
): void {
  const k = deltaKey(guildId, userId);
  const existing = localDelta.get(k) ?? { messages: 0, voiceMinutes: 0 };
  existing.messages += patch.messages ?? 0;
  existing.voiceMinutes += patch.voiceMinutes ?? 0;
  localDelta.set(k, existing);
}
function readLocalDelta(guildId: string, userId: string): LocalDelta {
  return localDelta.get(deltaKey(guildId, userId)) ?? { messages: 0, voiceMinutes: 0 };
}

function cacheKey(guildId: string, kind: AchievementKind): string {
  return `${guildId}|${kind}`;
}

export function invalidateAchievementCache(guildId: string, kind?: AchievementKind): void {
  if (kind) {
    cache.delete(cacheKey(guildId, kind));
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${guildId}|`)) cache.delete(key);
  }
}

async function getAchievements(
  guildId: string,
  kind: AchievementKind,
): Promise<Achievement[]> {
  const key = cacheKey(guildId, kind);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.achievements;
  try {
    const { achievements } = await api.listAchievements(guildId, { kind, enabled: true });
    cache.set(key, { fetchedAt: Date.now(), achievements });
    return achievements;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      cache.set(key, { fetchedAt: Date.now(), achievements: [] });
      return [];
    }
    log.warn('listAchievements failed', { guildId, kind, err: String(err) });
    return [];
  }
}

function celebrateEmbed(
  achievement: Achievement,
  userId: string,
  progress: number,
): EmbedBuilder {
  const lines = [
    `<@${userId}> unlocked **${achievement.emoji} ${achievement.name}**`,
    `_${achievement.description}_`,
  ];
  if (achievement.currencyReward > 0) {
    lines.push(`Reward: **${achievement.currencyReward}** coins`);
  }
  lines.push(`Progress at unlock: ${progress}`);
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('🏆 Achievement unlocked!')
    .setDescription(lines.join('\n'))
    .setTimestamp(new Date());
}

async function announce(
  guild: Guild,
  achievement: Achievement,
  userId: string,
  progress: number,
  preferredChannelId?: string,
): Promise<void> {
  const embed = celebrateEmbed(achievement, userId, progress);
  let channel: GuildTextBasedChannel | null = null;

  // Prefer the channel the triggering event happened in (most contextual).
  if (preferredChannelId) {
    const c = guild.channels.cache.get(preferredChannelId);
    if (c && c.type === ChannelType.GuildText) channel = c;
  }

  // Fall back to the audit-log channel so the celebration still lands
  // somewhere even when the trigger was a voice/leveling event.
  if (!channel) {
    try {
      const cfg = await api.getLoggingConfig(guild.id);
      if (cfg.channelId) {
        const c = guild.channels.cache.get(cfg.channelId);
        if (c && c.type === ChannelType.GuildText) channel = c;
      }
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) {
        log.warn('getLoggingConfig failed for achievement announce', {
          guildId: guild.id,
          err: String(err),
        });
      }
    }
  }

  if (!channel) return;
  await channel
    .send({ embeds: [embed], allowedMentions: { users: [userId] } })
    .catch((err) =>
      log.warn('Achievement announce failed', { guildId: guild.id, err: String(err) }),
    );
}

async function grantSideEffects(
  guildId: string,
  userId: string,
  achievement: Achievement,
): Promise<void> {
  if (achievement.currencyReward > 0) {
    try {
      await api.adjustBalance(guildId, userId, achievement.currencyReward);
    } catch (err) {
      log.warn('Achievement currency grant failed', {
        guildId,
        userId,
        slug: achievement.slug,
        err: String(err),
      });
    }
  }
  if (achievement.badgeSlug) {
    // Profile badges (v0.53) are an optional feature; the bot tolerates the
    // grantUserBadge endpoint not being present in older API builds. Wrap
    // dynamically so we don't hard-depend on a typed method.
    const maybeGrant = (
      api as unknown as {
        grantUserBadge?: (
          gid: string,
          body: { userId: string; slug: string },
        ) => Promise<unknown>;
      }
    ).grantUserBadge;
    if (typeof maybeGrant === 'function') {
      try {
        await maybeGrant(guildId, { userId, slug: achievement.badgeSlug });
      } catch (err) {
        log.warn('Achievement badge grant failed', {
          guildId,
          userId,
          slug: achievement.slug,
          badgeSlug: achievement.badgeSlug,
          err: String(err),
        });
      }
    }
  }
}

async function resolveCumulative(
  kind: AchievementKind,
  guildId: string,
  userId: string,
  explicit: number | undefined,
): Promise<number> {
  if (explicit !== undefined) return explicit;
  if (kind === 'messages' || kind === 'voice_minutes') {
    try {
      const stats = await api.getMemberActivity(guildId, userId);
      const delta = readLocalDelta(guildId, userId);
      return kind === 'messages'
        ? stats.messages + delta.messages
        : stats.voiceMinutes + delta.voiceMinutes;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) {
        log.warn('getMemberActivity failed', { guildId, userId, err: String(err) });
      }
      const delta = readLocalDelta(guildId, userId);
      return kind === 'messages' ? delta.messages : delta.voiceMinutes;
    }
  }
  // Caller must supply currentValue for level / reactions / stickers / custom.
  return 0;
}

/**
 * Evaluate progress on a counter event and award the highest-threshold-≤-
 * currentValue achievement of that kind that the user has not yet unlocked.
 *
 * Idempotent at the API layer; this helper also short-circuits when no
 * achievements are configured for the kind. Safe to call on every event —
 * a 60s per-(guild, kind) cache keeps the hot path lock-step with config edits.
 *
 * `currentValue` is the *cumulative* counter for the user. For `messages`
 * and `voice_minutes` it is resolved automatically (MemberActivity + the
 * in-process bump) when omitted; for `level`/`reactions`/`stickers`/`custom`
 * the caller must supply it.
 */
export async function evaluateOnEvent(
  client: Client,
  kind: AchievementKind,
  guildId: string,
  userId: string,
  currentValue?: number,
  preferredChannelId?: string,
): Promise<void> {
  const resolved = await resolveCumulative(kind, guildId, userId, currentValue);
  if (!Number.isFinite(resolved) || resolved < 1) return;
  const achievements = await getAchievements(guildId, kind);
  if (achievements.length === 0) return;

  // Filter to thresholds the user has crossed and pick the highest. Crossing
  // multiple thresholds in one event is rare (e.g. someone setting up the
  // bot retroactively) but we still want to award the most-prestigious one.
  const eligible = achievements
    .filter((a) => a.threshold <= resolved)
    .sort((a, b) => b.threshold - a.threshold);
  if (eligible.length === 0) return;

  for (const candidate of eligible) {
    let result;
    try {
      result = await api.awardUserAchievement(guildId, {
        userId,
        slug: candidate.slug,
        progress: resolved,
      });
    } catch (err) {
      log.warn('awardUserAchievement failed', {
        guildId,
        userId,
        slug: candidate.slug,
        err: String(err),
      });
      return;
    }
    if (result.unlocked) {
      const guild =
        client.guilds.cache.get(guildId) ??
        (await client.guilds.fetch(guildId).catch(() => null));
      if (guild) {
        await announce(
          guild,
          result.achievement,
          userId,
          resolved,
          preferredChannelId,
        );
      }
      await grantSideEffects(guildId, userId, result.achievement);
      return;
    }
    // Already unlocked — fall through and try the next-highest tier in case
    // the user crossed several thresholds in this event.
  }
}

/**
 * Fire-and-forget variant: callers wire this into event handlers without
 * having to await or catch. Errors are swallowed (and logged inside).
 */
export function evaluateOnEventBackground(
  client: Client,
  kind: AchievementKind,
  guildId: string,
  userId: string,
  currentValue?: number,
  preferredChannelId?: string,
): void {
  evaluateOnEvent(client, kind, guildId, userId, currentValue, preferredChannelId).catch(
    (err) => log.warn('evaluateOnEvent threw', { guildId, kind, err: String(err) }),
  );
}
