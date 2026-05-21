import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const pay: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Send currency to another member.')
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Recipient.').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('Amount to send.').setRequired(true).setMinValue(1),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    if (target.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot pay yourself.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (target.bot) {
      await interaction.reply({ content: 'You cannot pay a bot.', flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);
      await api.transfer(interaction.guildId, interaction.user.id, target.id, amount);
      await interaction.reply({
        content: `💸 Sent ${amount.toLocaleString()} ${cfg.currencySymbol} to ${target}.`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
