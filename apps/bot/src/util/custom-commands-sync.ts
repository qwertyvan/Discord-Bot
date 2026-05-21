import {
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import { env } from '../env.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

interface SyncResult {
  count: number;
}

/**
 * Replace the guild's custom-command set on Discord with whatever's in the
 * DB. Built-in slash commands stay registered globally and are unaffected.
 *
 * We POST the full set (not an upsert) so removals propagate.
 */
export async function syncCustomCommands(guildId: string): Promise<SyncResult> {
  let commands;
  try {
    commands = await api.listCustomCommands(guildId);
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn('syncCustomCommands: list failed', { guildId, status: err.status });
      return { count: 0 };
    }
    throw err;
  }

  const body: RESTPostAPIApplicationCommandsJSONBody[] = commands.commands.map((c) =>
    new SlashCommandBuilder().setName(c.name).setDescription(c.description).toJSON(),
  );

  try {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body });
  } catch (err) {
    log.warn('syncCustomCommands: Discord put failed', { guildId, err: String(err) });
  }

  return { count: body.length };
}
