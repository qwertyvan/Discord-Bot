import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { describePlayerError, musicPlayer } from '../../util/music-player.js';
import { requireVoice, replyEphemeral } from '../../util/music-voice.js';

function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '?:??';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function looksLikeUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const play: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Search for a track and queue it. Starts playback if idle.')
    .setContexts(0)
    .addStringOption((o) =>
      o.setName('query').setDescription('Song name, "Artist - Title", or a URL.').setRequired(true).setMaxLength(300),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const voice = await requireVoice(interaction);
    if (!voice.ok) {
      await replyEphemeral(interaction, voice.reply);
      return;
    }

    const query = interaction.options.getString('query', true).trim();
    if (!query) {
      await replyEphemeral(interaction, 'Provide a search query or URL.');
      return;
    }

    await interaction.deferReply();

    // Resolve the track. With a Lavalink client we'd search; without one we
    // fall back to treating the input as a URL + title.
    const playerAvailable = await musicPlayer.isAvailable();
    let title = query;
    let url: string;
    let durationSec: number | null = null;

    if (playerAvailable) {
      const search = await musicPlayer.search(query);
      if (!search.ok) {
        await interaction.editReply(describePlayerError(search));
        return;
      }
      const top = search.value[0];
      if (!top) {
        await interaction.editReply('No results found.');
        return;
      }
      title = top.author ? `${top.author} - ${top.title}` : top.title;
      url = top.url;
      durationSec = top.durationSec;
    } else if (looksLikeUrl(query)) {
      url = query;
    } else {
      // No URL and no Lavalink: persist a placeholder entry so the queue still
      // updates. The user is told playback is disabled.
      url = `https://example.invalid/search?q=${encodeURIComponent(query)}`;
    }

    try {
      const added = await api.addTrack(interaction.guildId, {
        title,
        url,
        ...(durationSec !== null ? { durationSec } : {}),
        requesterId: interaction.user.id,
      });
      const queue = await api.getQueue(interaction.guildId);

      // If the player is available and nothing else is playing, kick off
      // playback now. We use "tracks.length === 1 OR position equals current"
      // as a rough "is the player idle" heuristic.
      let playbackNote = '';
      if (playerAvailable) {
        const connect = await musicPlayer.connectIfNeeded(
          interaction.guildId,
          voice.voiceChannelId,
        );
        if (!connect.ok) {
          playbackNote = `\n${describePlayerError(connect)}`;
        } else if (added.position === queue.currentIndex) {
          const playRes = await musicPlayer.play(interaction.guildId, {
            title,
            url,
            ...(durationSec !== null ? { durationSec } : {}),
          });
          if (!playRes.ok) playbackNote = `\n${describePlayerError(playRes)}`;
        }
      } else {
        playbackNote =
          '\nNote: Lavalink client not installed — track recorded in the queue, but no audio will play.';
      }

      await interaction.editReply({
        content: `Queued **${title}** (${formatDuration(durationSec)}) at position #${added.position + 1}.${playbackNote}`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to queue track.';
      // editReply doesn't accept ephemeral flags, but the original message
      // here is the deferred reply (not ephemeral).
      await interaction.editReply({ content: msg });
    }
  },
};
