import { Events, type Client } from 'discord.js';
import { log } from '../logger.js';
import { api, ApiError } from '../api-client.js';

export function registerGuildLifecycle(client: Client): void {
  client.on(Events.GuildCreate, async (guild) => {
    log.info('Joined guild', { guildId: guild.id, name: guild.name });
    try {
      await api.upsertGuild(guild.id, { name: guild.name, iconUrl: guild.iconURL({ size: 256 }) });
    } catch (err) {
      if (err instanceof ApiError) {
        log.warn('Failed to register guild', { guildId: guild.id, status: err.status });
      } else {
        log.error('Unexpected guild register error', { guildId: guild.id, err: String(err) });
      }
    }
  });

  client.on(Events.GuildDelete, async (guild) => {
    log.info('Left guild', { guildId: guild.id, name: guild.name });
    try {
      await api.deleteGuild(guild.id);
    } catch (err) {
      if (err instanceof ApiError && err.status !== 404) {
        log.warn('Failed to deregister guild', { guildId: guild.id, status: err.status });
      }
    }
  });
}
