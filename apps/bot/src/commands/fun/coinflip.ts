import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const coinflip: SlashCommand = {
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin.'),
  async execute(interaction) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    await interaction.reply(`🪙 **${result}**`);
  },
};
