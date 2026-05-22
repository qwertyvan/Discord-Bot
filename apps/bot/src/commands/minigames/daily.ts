import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

// Named `/daily-streak` rather than `/daily` because the economy module
// (apps/bot/src/commands/economy/daily.ts) already owns `/daily` for currency
// payouts. This complementary command tracks a UTC-day streak and, when an
// economy is configured, also pays out the configured `dailyReward`.
export const dailyStreak: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('daily-streak')
    .setDescription('Claim your daily streak (once per UTC day).')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    try {
      const result = await api.claimDailyStreak(interaction.guildId, interaction.user.id);
      if (result.alreadyClaimed) {
        await interaction.reply({
          content: `🕓 You already claimed today's streak. Current streak: **${result.streak.streak}** day${result.streak.streak === 1 ? '' : 's'}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('🔥 Daily streak claimed')
        .setColor(0xfee75c)
        .setDescription(
          [
            `Streak: **${result.streak.streak}** day${result.streak.streak === 1 ? '' : 's'} in a row`,
            result.rewardCurrency > 0
              ? `Reward: **${result.rewardCurrency.toLocaleString()}** 🪙`
              : 'No currency reward (economy disabled).',
          ].join('\n'),
        );
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
