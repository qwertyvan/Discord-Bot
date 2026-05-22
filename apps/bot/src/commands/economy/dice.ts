import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import type { DiceChoice } from '@discord-bot/shared';

const CHOICES: { name: string; value: DiceChoice }[] = [
  { name: 'High (4-6) · 2x', value: 'high' },
  { name: 'Low (1-3) · 2x', value: 'low' },
  { name: 'Even · 2x', value: 'even' },
  { name: 'Odd · 2x', value: 'odd' },
  { name: 'Exact: 1 · 6x', value: '1' },
  { name: 'Exact: 2 · 6x', value: '2' },
  { name: 'Exact: 3 · 6x', value: '3' },
  { name: 'Exact: 4 · 6x', value: '4' },
  { name: 'Exact: 5 · 6x', value: '5' },
  { name: 'Exact: 6 · 6x', value: '6' },
];

export const dice: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Roll a die against your wager.')
    .setContexts(0)
    .addIntegerOption((o) =>
      o
        .setName('bet')
        .setDescription('Amount to wager.')
        .setRequired(true)
        .setMinValue(1),
    )
    .addStringOption((o) =>
      o
        .setName('choice')
        .setDescription('What you are betting on.')
        .setRequired(true)
        .addChoices(...CHOICES),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const bet = interaction.options.getInteger('bet', true);
    const choice = interaction.options.getString('choice', true) as DiceChoice;
    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);
      const result = await api.playDice(interaction.guildId, {
        userId: interaction.user.id,
        bet,
        choice,
      });
      const sign = result.delta >= 0 ? '+' : '';
      const outcome = result.win
        ? `Win! ${result.multiplier}x — ${sign}${result.delta.toLocaleString()} ${cfg.currencySymbol}.`
        : `No luck. Lost ${bet.toLocaleString()} ${cfg.currencySymbol}.`;
      await interaction.reply(
        `🎲 Rolled **${result.roll}** (you picked \`${choice}\`).\n${outcome}\nBalance: ${result.balance.toLocaleString()} ${cfg.currencyName}.`,
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
