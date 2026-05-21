import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const daily: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily reward.')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);
      const updated = await api.claimDaily(interaction.guildId, interaction.user.id);
      await interaction.reply({
        content: `💰 You claimed **${updated.reward.toLocaleString()}** ${cfg.currencySymbol}. New balance: ${updated.amount.toLocaleString()} ${cfg.currencyName}.`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
