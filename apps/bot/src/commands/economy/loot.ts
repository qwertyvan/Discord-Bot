import { EmbedBuilder, MessageFlags, SlashCommandBuilder, time } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const loot: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('loot')
    .setDescription('Open your daily loot crate.')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    try {
      const cfg = await api.getEconomyConfig(interaction.guildId);
      const result = await api.claimLoot(interaction.guildId, interaction.user.id);
      const lines: string[] = [];
      if (result.itemAwarded) {
        lines.push(`Crate item: **${result.itemAwarded.name}** \`${result.itemAwarded.slug}\``);
      }
      if (result.currencyAwarded > 0) {
        lines.push(
          `Currency: ${result.currencyAwarded.toLocaleString()} ${cfg.currencySymbol}`,
        );
      }
      if (lines.length === 0) lines.push('A dud crate. Better luck tomorrow.');
      const nextDate = new Date(result.nextClaimAt);
      const embed = new EmbedBuilder()
        .setTitle('Loot crate opened')
        .setColor(0xa970ff)
        .setDescription(lines.join('\n'))
        .addFields(
          { name: 'Streak', value: `${result.streak}`, inline: true },
          { name: 'Balance', value: `${result.balance.toLocaleString()} ${cfg.currencyName}`, inline: true },
          { name: 'Next crate', value: time(nextDate, 'R'), inline: true },
        );
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
