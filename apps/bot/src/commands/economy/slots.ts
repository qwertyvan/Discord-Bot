import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const slots: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Spin the slots.')
    .setContexts(0)
    .addIntegerOption((o) =>
      o
        .setName('bet')
        .setDescription('Amount to wager.')
        .setRequired(true)
        .setMinValue(1),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const bet = interaction.options.getInteger('bet', true);
    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);
      const result = await api.playSlots(interaction.guildId, {
        userId: interaction.user.id,
        bet,
      });
      const reels = result.reels.join(' | ');
      const sign = result.delta >= 0 ? '+' : '';
      const outcome =
        result.multiplier === 0
          ? `No match. Lost ${bet.toLocaleString()} ${cfg.currencySymbol}.`
          : `${result.multiplier}x match — ${sign}${result.delta.toLocaleString()} ${cfg.currencySymbol}.`;
      await interaction.reply(
        `🎰 ${reels}\n${outcome}\nBalance: ${result.balance.toLocaleString()} ${cfg.currencyName}.`,
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
