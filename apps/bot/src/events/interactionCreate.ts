import { Events, MessageFlags, type Client } from 'discord.js';
import { log } from '../logger.js';
import { getCommandRegistry } from '../commands/registry.js';

export function registerInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = getCommandRegistry().byName.get(interaction.commandName);
    if (!command) {
      log.warn('Unknown command', { name: interaction.commandName });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      log.error('Command threw', {
        command: interaction.commandName,
        err: err instanceof Error ? err.message : String(err),
      });
      const content = 'Something went wrong running that command.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });
}
