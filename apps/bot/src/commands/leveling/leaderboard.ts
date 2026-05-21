import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const leaderboard: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top XP earners in this server.')
    .setContexts(0)
    .addIntegerOption((o) =>
      o.setName('limit').setDescription('How many to show (1–25).').setMinValue(1).setMaxValue(25),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const limit = interaction.options.getInteger('limit') ?? 10;
    try {
      const { entries } = await api.getLeaderboard(interaction.guildId, limit);
      if (entries.length === 0) {
        await interaction.reply({ content: 'No XP recorded yet.', flags: MessageFlags.Ephemeral });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(`Leaderboard · ${interaction.guild?.name ?? ''}`)
        .setColor(0x5865f2)
        .setDescription(
          entries
            .map(
              (e) =>
                `**#${e.rank}** · <@${e.userId}> — level **${e.level}** · ${e.xp.toLocaleString()} XP`,
            )
            .join('\n'),
        );
      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to fetch leaderboard.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
