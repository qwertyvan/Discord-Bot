import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const balance: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Show your (or someone else\'s) currency balance.')
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Whose balance to show.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const target = interaction.options.getUser('user') ?? interaction.user;
    try {
      const [cfg, bal] = await Promise.all([
        api.getEconomyConfig(interaction.guildId),
        api.getBalance(interaction.guildId, target.id),
      ]);
      if (!cfg.enabled) {
        await interaction.reply({ content: 'Economy is not enabled here.', flags: MessageFlags.Ephemeral });
        return;
      }
      const embed = new EmbedBuilder()
        .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
        .setColor(0xfee75c)
        .setDescription(`${cfg.currencySymbol} **${bal.amount.toLocaleString()}** ${cfg.currencyName}`);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to fetch balance.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
