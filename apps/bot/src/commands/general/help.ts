import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { getCommandRegistry } from '../registry.js';

export const help: SlashCommand = {
  data: new SlashCommandBuilder().setName('help').setDescription('List available commands.'),
  async execute(interaction) {
    const registry = getCommandRegistry();
    const grouped = new Map<string, string[]>();
    for (const { group, command } of registry.entries) {
      const list = grouped.get(group) ?? [];
      list.push(`\`/${command.data.name}\` — ${command.data.description}`);
      grouped.set(group, list);
    }

    const embed = new EmbedBuilder().setTitle('Commands').setColor(0x5865f2);
    for (const [group, cmds] of grouped) {
      embed.addFields({ name: capitalize(group), value: cmds.join('\n') });
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
