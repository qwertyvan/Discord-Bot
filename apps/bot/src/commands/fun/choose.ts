import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const choose: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Pick one of several options at random.')
    .addStringOption((o) =>
      o
        .setName('options')
        .setDescription('Comma-separated list, e.g. "pizza, sushi, burger".')
        .setRequired(true)
        .setMaxLength(500),
    ),
  async execute(interaction) {
    const raw = interaction.options.getString('options', true);
    const options = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (options.length < 2) {
      await interaction.reply({ content: 'Provide at least two comma-separated options.', flags: MessageFlags.Ephemeral });
      return;
    }
    const pick = options[Math.floor(Math.random() * options.length)];
    await interaction.reply(`🎯 I choose: **${pick}**`);
  },
};
