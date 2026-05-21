import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const econLeaderboard: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('rich')
    .setDescription('Show the wealthiest members on this server.')
    .setContexts(0)
    .addIntegerOption((o) =>
      o.setName('limit').setDescription('How many (1–25).').setMinValue(1).setMaxValue(25),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const limit = interaction.options.getInteger('limit') ?? 10;
    try {
      const [cfg, lb] = await Promise.all([
        api.getEconomyConfig(interaction.guildId),
        api.economyLeaderboard(interaction.guildId, limit),
      ]);
      if (lb.entries.length === 0) {
        await interaction.reply({ content: 'No balances yet.', flags: MessageFlags.Ephemeral });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(`Wealthiest — ${cfg.currencyName}`)
        .setColor(0xfee75c)
        .setDescription(
          lb.entries
            .map((e) => `**#${e.rank}** · <@${e.userId}> — ${cfg.currencySymbol} ${e.amount.toLocaleString()}`)
            .join('\n'),
        );
      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
