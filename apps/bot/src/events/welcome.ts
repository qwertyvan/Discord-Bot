import { ChannelType, Events, type Client, type Guild, type TextChannel } from 'discord.js';
import { log } from '../logger.js';
import { api, ApiError } from '../api-client.js';
import { renderTemplate } from '../welcome/template.js';

export function registerWelcomeEvents(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    const config = await fetchConfig(member.guild.id);
    if (!config?.enabled || !config.channelId || !config.joinTemplate) return;

    const channel = await resolveTextChannel(member.guild, config.channelId);
    if (!channel) return;

    const message = renderTemplate(config.joinTemplate, {
      user: member.user,
      member,
      guild: member.guild,
    });
    // allowedMentions limits pings to the joining user — load-bearing for the
    // {username} placeholder which renders literal text from the user's
    // display name and could otherwise become an @everyone if relaxed.
    await channel.send({ content: message, allowedMentions: { users: [member.id] } }).catch((err) => {
      log.warn('Failed to send welcome message', {
        guildId: member.guild.id,
        err: String(err),
      });
    });
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const config = await fetchConfig(member.guild.id);
    if (!config?.enabled || !config.channelId || !config.leaveTemplate) return;

    const channel = await resolveTextChannel(member.guild, config.channelId);
    if (!channel) return;

    const message = renderTemplate(config.leaveTemplate, {
      user: member.user,
      member,
      guild: member.guild,
    });
    await channel.send({ content: message, allowedMentions: { parse: [] } }).catch((err) => {
      log.warn('Failed to send leave message', {
        guildId: member.guild.id,
        err: String(err),
      });
    });
  });
}

async function resolveTextChannel(guild: Guild, channelId: string): Promise<TextChannel | null> {
  const cached = guild.channels.cache.get(channelId);
  if (cached) {
    return cached.type === ChannelType.GuildText ? (cached as TextChannel) : null;
  }
  const fetched = await guild.channels.fetch(channelId).catch(() => null);
  if (!fetched) {
    log.info('Welcome channel missing — was it deleted?', { guildId: guild.id, channelId });
    return null;
  }
  return fetched.type === ChannelType.GuildText ? (fetched as TextChannel) : null;
}

async function fetchConfig(guildId: string) {
  try {
    return await api.getWelcomeConfig(guildId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    log.warn('Failed to fetch welcome config', { guildId, err: String(err) });
    return null;
  }
}
