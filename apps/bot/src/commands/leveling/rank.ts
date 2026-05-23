import { AttachmentBuilder, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { renderRankCard } from '../../util/canvas/rank-card.js';
import { log } from '../../logger.js';

const BAR_CELLS = 16;

function bar(progress: number): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round(progress * BAR_CELLS)));
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
}

export const rank: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription("Show your (or someone else's) rank card.")
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Whose rank to show. Defaults to you.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const target = interaction.options.getUser('user') ?? interaction.user;
    try {
      await interaction.deferReply();
      const stats = await api.getMemberLevel(interaction.guildId, target.id);
      const cfg = await api.getLevelConfig(interaction.guildId).catch(() => null);

      if (cfg?.rankCardEnabled) {
        try {
          const png = await renderRankCard({
            username: target.globalName ?? target.username,
            avatarUrl: target.displayAvatarURL({ size: 256, extension: 'png' }),
            level: stats.level,
            rank: stats.rank,
            xp: stats.xp,
            currentLevelXp: stats.currentLevelXp,
            nextLevelXp: stats.nextLevelXp,
          });
          await interaction.editReply({
            files: [new AttachmentBuilder(png, { name: 'rank.png' })],
          });
          return;
        } catch (err) {
          log.warn('Rank card render failed; falling back to embed', { err: String(err) });
        }
      }

      const cur = stats.xp - stats.currentLevelXp;
      const span = Math.max(1, stats.nextLevelXp - stats.currentLevelXp);
      const progress = cur / span;
      const prestigePrefix = stats.prestige > 0 ? `⭐ P${stats.prestige} · ` : '';
      const embed = new EmbedBuilder()
        .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
        .setColor(0x5865f2)
        .setDescription(
          `${prestigePrefix}Level **${stats.level}** · **${stats.xp.toLocaleString()}** XP`,
        )
        .addFields(
          { name: 'Level', value: String(stats.level), inline: true },
          { name: 'XP', value: stats.xp.toLocaleString(), inline: true },
          { name: 'Rank', value: stats.rank ? `#${stats.rank}` : 'unranked', inline: true },
          { name: 'Progress', value: `\`${bar(progress)}\` ${cur} / ${span} XP` },
          { name: 'Voice', value: `${stats.voiceMinutes} min`, inline: true },
        );
      if (stats.prestige > 0) {
        embed.addFields({ name: 'Prestige', value: `⭐ P${stats.prestige}`, inline: true });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to fetch rank.';
      if (interaction.deferred) await interaction.editReply(msg);
      else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
