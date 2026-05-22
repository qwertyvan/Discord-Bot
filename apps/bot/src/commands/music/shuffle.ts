import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { replyEphemeral, requireVoice } from '../../util/music-voice.js';

export const shuffle: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the tracks queued after the current one.')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const voice = await requireVoice(interaction);
    if (!voice.ok) {
      await replyEphemeral(interaction, voice.reply);
      return;
    }
    try {
      const q = await api.setQueueState(interaction.guildId, { shuffle: true });
      const upcoming = Math.max(0, q.tracks.length - q.currentIndex - 1);
      await replyEphemeral(
        interaction,
        `🔀 Shuffled ${upcoming} upcoming track${upcoming === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to shuffle.';
      await replyEphemeral(interaction, msg);
    }
  },
};
