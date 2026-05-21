import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const avatar: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Show a user's avatar.")
    .addUserOption((o) =>
      o.setName('user').setDescription('The user (defaults to you).'),
    ),
  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const url = user.displayAvatarURL({ size: 1024 });
    const embed = new EmbedBuilder()
      .setAuthor({ name: user.tag })
      .setImage(url)
      .setURL(url)
      .setColor(0x5865f2);
    await interaction.reply({ embeds: [embed] });
  },
};
