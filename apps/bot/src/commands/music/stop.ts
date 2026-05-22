import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { describePlayerError, musicPlayer } from '../../util/music-player.js';
import { replyEphemeral, requireVoice } from '../../util/music-voice.js';

export const stop: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue, and leave the voice channel.')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const voice = await requireVoice(interaction, { requireSameAsBot: true });
    if (!voice.ok) {
      await replyEphemeral(interaction, voice.reply);
      return;
    }
    try {
      await api.clearQueue(interaction.guildId);
      const res = await musicPlayer.stop(interaction.guildId);
      const note = res.ok ? '' : `\n${describePlayerError(res)}`;
      await replyEphemeral(interaction, `⏹️ Stopped. Queue cleared.${note}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to stop.';
      await replyEphemeral(interaction, msg);
    }
  },
};
