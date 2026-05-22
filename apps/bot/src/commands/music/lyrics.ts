import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { fetchLyrics } from '../../util/lyrics.js';

const LYRICS_FIELD_MAX = 4000;

export const lyrics: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Look up lyrics. Defaults to the currently-playing track.')
    .setContexts(0)
    .addStringOption((o) =>
      o
        .setName('query')
        .setDescription('Override: "Artist - Title" or just the title.')
        .setMaxLength(200),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    let query = interaction.options.getString('query')?.trim() ?? '';
    if (!query) {
      try {
        const q = await api.getQueue(interaction.guildId);
        const current = q.tracks[q.currentIndex];
        if (!current) {
          await interaction.reply({
            content: 'No track is currently playing. Pass a `query` to look up lyrics directly.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        query = current.title;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Failed to fetch the queue.';
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    await interaction.deferReply();
    const result = await fetchLyrics(query);
    if (!result) {
      await interaction.editReply({
        content: `No lyrics found for **${query}**. (Tip: format as "Artist - Title".)`,
      });
      return;
    }

    const truncated = result.length > LYRICS_FIELD_MAX
      ? `${result.slice(0, LYRICS_FIELD_MAX - 20)}\n…\n*(truncated)*`
      : result;
    const embed = new EmbedBuilder()
      .setTitle(`Lyrics: ${query}`)
      .setColor(0x5865f2)
      .setDescription(truncated)
      .setFooter({ text: 'Source: lyrics.ovh' });
    await interaction.editReply({ embeds: [embed] });
  },
};
