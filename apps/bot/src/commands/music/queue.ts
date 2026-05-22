import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '?:??';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PAGE_SIZE = 10;

export const queue: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current music queue.')
    .setContexts(0)
    .addIntegerOption((o) =>
      o.setName('page').setDescription('Page number (10 tracks per page).').setMinValue(1),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    try {
      const q = await api.getQueue(interaction.guildId);
      if (q.tracks.length === 0) {
        await interaction.reply({
          content: 'The queue is empty. Use `/play <query>` to add a track.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const page = interaction.options.getInteger('page') ?? 1;
      const totalPages = Math.max(1, Math.ceil(q.tracks.length / PAGE_SIZE));
      const safePage = Math.min(Math.max(page, 1), totalPages);
      const start = (safePage - 1) * PAGE_SIZE;
      const slice = q.tracks.slice(start, start + PAGE_SIZE);

      const lines = slice.map((t, idx) => {
        const absoluteIdx = start + idx;
        const marker = absoluteIdx === q.currentIndex ? '▶' : ' ';
        const num = String(absoluteIdx + 1).padStart(2, ' ');
        const dur = formatDuration(t.durationSec);
        return `${marker} \`#${num}\` [${t.title}](${t.url}) · \`${dur}\` · <@${t.requesterId}>`;
      });

      const embed = new EmbedBuilder()
        .setTitle('Music queue')
        .setColor(0x5865f2)
        .setDescription(lines.join('\n'))
        .setFooter({
          text: `Page ${safePage}/${totalPages} · ${q.tracks.length} track${q.tracks.length === 1 ? '' : 's'} · volume ${q.volume} · loop ${q.loopMode}`,
        });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to fetch queue.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
