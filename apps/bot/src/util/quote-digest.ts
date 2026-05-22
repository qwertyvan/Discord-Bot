import { ChannelType, EmbedBuilder, type Client, type Guild, type TextChannel } from 'discord.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';
import type { Quote } from '@discord-bot/shared';

export const QUOTE_DIGEST_TICK_MS = 60 * 60 * 1000; // hourly check

const DIGEST_DAYS = 7;
const DIGEST_TOP = 5;

const lastFiredAt = new Map<string, number>(); // guildId -> ms timestamp

// Fire once per Sunday 18:00 UTC (any minute within that hour, gated to at
// most once per 24h per guild).
function shouldFireWeekly(now: Date, guildId: string): boolean {
  if (now.getUTCDay() !== 0) return false; // Sunday
  if (now.getUTCHours() !== 18) return false;
  const last = lastFiredAt.get(guildId);
  if (last && Date.now() - last < 24 * 60 * 60 * 1000) return false;
  return true;
}

function buildDigestEmbed(guildId: string, quotes: Quote[]) {
  const lines = quotes.map((q, idx) => {
    const snippet = q.content.replace(/\n/g, ' ').slice(0, 200);
    const channelLink = `https://discord.com/channels/${guildId}/${q.sourceChannelId}/${q.sourceMessageId}`;
    return `**${idx + 1}.** [${q.reactionCount} ⭐](${channelLink}) <@${q.authorId}>: ${snippet}`;
  });
  return new EmbedBuilder()
    .setTitle('🏆 Top quotes this week')
    .setColor(0xf59e0b)
    .setDescription(lines.join('\n\n').slice(0, 4000) || '_No quotes saved this week._')
    .setFooter({ text: `Top ${quotes.length} • saved in the last ${DIGEST_DAYS}d` })
    .setTimestamp(new Date());
}

export async function runQuoteDigest(guild: Guild): Promise<boolean> {
  let cfg;
  try {
    cfg = await api.getQuoteConfig(guild.id);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) {
      log.warn('quote digest getQuoteConfig failed', { guildId: guild.id, err: String(err) });
    }
    return false;
  }
  if (!cfg.weeklyDigest || !cfg.channelId) return false;

  let result;
  try {
    result = await api.topQuotes(guild.id, { days: DIGEST_DAYS, limit: DIGEST_TOP });
  } catch (err) {
    log.warn('topQuotes failed', { guildId: guild.id, err: String(err) });
    return false;
  }
  if (result.quotes.length === 0) return false;

  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return false;

  try {
    await (channel as TextChannel).send({
      embeds: [buildDigestEmbed(guild.id, result.quotes).toJSON()],
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (err) {
    log.warn('quote digest send failed', { guildId: guild.id, err: String(err) });
    return false;
  }
}

export async function sweepQuoteDigest(client: Client): Promise<void> {
  const now = new Date();
  for (const guild of client.guilds.cache.values()) {
    if (!shouldFireWeekly(now, guild.id)) continue;
    lastFiredAt.set(guild.id, Date.now());
    await runQuoteDigest(guild).catch((err) =>
      log.warn('Quote digest run failed', { guildId: guild.id, err: String(err) }),
    );
  }
}
