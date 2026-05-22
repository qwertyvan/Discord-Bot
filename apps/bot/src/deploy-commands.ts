import { REST, Routes } from 'discord.js';
import { env } from './env.js';
import { getCommandRegistry } from './commands/registry.js';
import { log } from './logger.js';

async function main(): Promise<void> {
  const registry = getCommandRegistry();
  // Slash and context-menu commands serialize through the same REST PUT.
  const body = [
    ...registry.entries.map(({ command }) => command.data.toJSON()),
    ...registry.contextEntries.map(({ command }) => command.data.toJSON()),
  ];

  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  const route = env.DEV_GUILD_ID
    ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DEV_GUILD_ID)
    : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

  log.info('Registering slash commands', {
    count: body.length,
    scope: env.DEV_GUILD_ID ? `guild ${env.DEV_GUILD_ID}` : 'global',
  });

  await rest.put(route, { body });
  log.info('Slash commands registered.');
}

main().catch((err) => {
  log.error('Failed to register commands', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
