import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const about: SlashCommand = {
  data: new SlashCommandBuilder().setName('about').setDescription('About this bot.'),
  async execute(interaction) {
    const { client } = interaction;
    const embed = new EmbedBuilder()
      .setTitle(client.user?.username ?? 'Discord Bot')
      .setThumbnail(client.user?.displayAvatarURL() ?? null)
      .setDescription(
        'Open-source TypeScript Discord bot with moderation, utility, and fun commands, plus a web admin dashboard.',
      )
      .addFields(
        { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
        { name: 'Node', value: process.version, inline: true },
        { name: 'License', value: 'MIT', inline: false },
      )
      .setColor(0x5865f2);
    await interaction.reply({ embeds: [embed] });
  },
};
