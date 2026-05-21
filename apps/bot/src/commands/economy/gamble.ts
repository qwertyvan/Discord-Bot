import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const gamble: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('gamble')
    .setDescription('Wager currency on a quick game.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('coinflip')
        .setDescription('Bet on a coin flip. 1:1 payout.')
        .addIntegerOption((o) =>
          o.setName('stake').setDescription('Amount to bet.').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('slots')
        .setDescription('Spin the slots. 2-match → 2x · 3-match → 6x.')
        .addIntegerOption((o) =>
          o.setName('stake').setDescription('Amount to bet.').setRequired(true).setMinValue(1),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand() as 'coinflip' | 'slots';
    const stake = interaction.options.getInteger('stake', true);
    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);
      const result = await api.gamble(interaction.guildId, interaction.user.id, { stake, game: sub });
      const sign = result.delta >= 0 ? '+' : '';
      let line: string;
      if (sub === 'coinflip') {
        line = `🪙 The coin landed **${result.outcome}** — you ${result.win ? 'won' : 'lost'} ${Math.abs(result.delta).toLocaleString()} ${cfg.currencySymbol}.`;
      } else {
        line = `🎰 ${(result.reels ?? []).join(' ')} — ${
          result.multiplier === 0
            ? `no match. Lost ${Math.abs(result.delta).toLocaleString()}.`
            : `${result.multiplier}x match! ${sign}${result.delta.toLocaleString()} ${cfg.currencySymbol}.`
        }`;
      }
      await interaction.reply(
        `${line}\nBalance: ${result.amount.toLocaleString()} ${cfg.currencyName}.`,
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
