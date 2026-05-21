import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

const FLAVOR = [
  'You washed cars for the afternoon',
  'You debugged a stranger\'s React app',
  'You walked dogs at the local park',
  'You streamed for a few hours',
  'You wrote a viral tweet',
  'You delivered pizzas',
  'You modded a Minecraft server',
];

export const work: SlashCommand = {
  data: new SlashCommandBuilder().setName('work').setDescription('Earn some currency.').setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);
      const updated = await api.doWork(interaction.guildId, interaction.user.id);
      const flavor = FLAVOR[Math.floor(Math.random() * FLAVOR.length)];
      await interaction.reply({
        content: `🧰 ${flavor} and earned **${updated.reward.toLocaleString()}** ${cfg.currencySymbol}. Balance: ${updated.amount.toLocaleString()} ${cfg.currencyName}.`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
