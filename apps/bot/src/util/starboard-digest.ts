import { ChannelType, type Client, type Guild, type TextChannel } from 'discord.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';
import { buildStarboardDigestEmbed } from './starboard-render.js';

export interface DigestResult {
  posted: boolean;
  reason?: 'disabled' | 'no-channel' | 'no-entries' | 'channel-missing' | 'send-failed';
  entryCount?: number;
}

const DIGEST_DAYS = 7;
const DIGEST_TOP = 5;

export async function runStarboardDigest(guild: Guild): Promise<DigestResult> {
  let config;
  try {
    config = await api.getStarboardConfig(guild.id);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) {
      log.warn('digest getStarboardConfig failed', { guildId: guild.id, err: String(err) });
    }
    return { posted: false, reason: 'disabled' };
  }

  if (!config.enabled) return { posted: false, reason: 'disabled' };
  if (!config.channelId) return { posted: false, reason: 'no-channel' };

  let result;
  try {
    result = await api.listStarboardEntries(guild.id, { top: DIGEST_TOP, days: DIGEST_DAYS });
  } catch (err) {
    log.warn('listStarboardEntries failed', { guildId: guild.id, err: String(err) });
    return { posted: false, reason: 'send-failed' };
  }
  if (result.entries.length === 0) return { posted: false, reason: 'no-entries' };

  const channel = guild.channels.cache.get(config.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return { posted: false, reason: 'channel-missing' };
  }

  const embed = buildStarboardDigestEmbed({
    entries: result.entries,
    emoji: config.emoji,
    guildId: guild.id,
    days: DIGEST_DAYS,
  });

  try {
    await (channel as TextChannel).send({ embeds: [embed] });
    return { posted: true, entryCount: result.entries.length };
  } catch (err) {
    log.warn('Starboard digest send failed', { guildId: guild.id, err: String(err) });
    return { posted: false, reason: 'send-failed' };
  }
}

const DIGEST_TICK_MS = 60 * 60 * 1000; // hourly check
const lastFiredAt = new Map<string, number>(); // key: guildId; ms timestamp

// Returns true if we should fire for this guild now: weekly on Sunday at
// midnight UTC (any hour from 00:00 to 00:59 UTC, once per week).
function shouldFireWeekly(now: Date, guildId: string): boolean {
  if (now.getUTCDay() !== 0) return false; // 0 = Sunday
  if (now.getUTCHours() !== 0) return false;
  const last = lastFiredAt.get(guildId);
  if (last && Date.now() - last < 24 * 60 * 60 * 1000) return false;
  return true;
}

export async function sweepStarboardDigest(client: Client): Promise<void> {
  const now = new Date();
  for (const guild of client.guilds.cache.values()) {
    if (!shouldFireWeekly(now, guild.id)) continue;
    lastFiredAt.set(guild.id, Date.now());
    await runStarboardDigest(guild).catch((err) =>
      log.warn('Weekly digest run failed', { guildId: guild.id, err: String(err) }),
    );
  }
}

export const STARBOARD_DIGEST_TICK_MS = DIGEST_TICK_MS;
