import { Events, type Client } from 'discord.js';
import { log } from '../logger.js';
import { api } from '../api-client.js';
import { ApiError } from '../api-client.js';

export function registerReady(client: Client): void {
  client.once(Events.ClientReady, async (ready) => {
    log.info('Bot ready', {
      user: ready.user.tag,
      guildCount: ready.guilds.cache.size,
    });

    // Sync guild registry with the API so the dashboard knows which guilds the bot is in.
    for (const guild of ready.guilds.cache.values()) {
      try {
        await api.upsertGuild(guild.id, {
          name: guild.name,
          iconUrl: guild.iconURL({ size: 256 }),
        });
      } catch (err) {
        if (err instanceof ApiError) {
          log.warn('Failed to sync guild on ready', {
            guildId: guild.id,
            status: err.status,
            code: err.code,
          });
        } else {
          log.error('Unexpected error syncing guild', { guildId: guild.id, err: String(err) });
        }
      }
    }
  });
}
