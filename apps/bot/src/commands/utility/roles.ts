import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const roles: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('List all roles in this server.')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sorted = interaction.guild.roles.cache
      .filter((r) => r.id !== interaction.guild!.id)
      .sort((a, b) => b.position - a.position);

    if (sorted.size === 0) {
      await interaction.reply({ content: 'No roles in this server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = sorted.map((r) => `${r} — \`${r.members.size}\` members`);
    const chunks: string[] = [];
    let current = '';
    for (const line of lines) {
      if (current.length + line.length + 1 > 1000) {
        chunks.push(current);
        current = '';
      }
      current += (current ? '\n' : '') + line;
    }
    if (current) chunks.push(current);

    const embed = new EmbedBuilder()
      .setTitle(`Roles in ${interaction.guild.name} (${sorted.size})`)
      .setColor(0x5865f2);
    for (const [i, chunk] of chunks.entries()) {
      embed.addFields({ name: i === 0 ? '​' : '…', value: chunk });
    }
    await interaction.reply({ embeds: [embed] });
  },
};
