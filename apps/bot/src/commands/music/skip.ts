import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { describePlayerError, musicPlayer } from '../../util/music-player.js';
import { replyEphemeral, requireVoice } from '../../util/music-voice.js';

export const skip: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the currently-playing track.')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const voice = await requireVoice(interaction, { requireSameAsBot: true });
    if (!voice.ok) {
      await replyEphemeral(interaction, voice.reply);
      return;
    }
    try {
      const queue = await api.getQueue(interaction.guildId);
      const next = queue.currentIndex + 1;
      if (next >= queue.tracks.length) {
        await replyEphemeral(interaction, 'Nothing left in the queue to skip to.');
        return;
      }
      await api.setQueueState(interaction.guildId, { currentIndex: next });
      const skipRes = await musicPlayer.skip(interaction.guildId);
      const note = skipRes.ok ? '' : `\n${describePlayerError(skipRes)}`;
      const nextTrack = queue.tracks[next]!;
      await replyEphemeral(
        interaction,
        `⏭️ Skipped. Now playing **${nextTrack.title}**.${note}`,
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to skip.';
      await replyEphemeral(interaction, msg);
    }
  },
};
