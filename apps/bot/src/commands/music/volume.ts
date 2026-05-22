import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { describePlayerError, musicPlayer } from '../../util/music-player.js';
import { replyEphemeral, requireVoice } from '../../util/music-voice.js';

export const volume: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the music player volume (0-100).')
    .setContexts(0)
    .addIntegerOption((o) =>
      o.setName('level').setDescription('0-100').setRequired(true).setMinValue(0).setMaxValue(100),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const voice = await requireVoice(interaction, { requireSameAsBot: true });
    if (!voice.ok) {
      await replyEphemeral(interaction, voice.reply);
      return;
    }
    const level = interaction.options.getInteger('level', true);
    try {
      await api.setQueueState(interaction.guildId, { volume: level });
      const res = await musicPlayer.setVolume(interaction.guildId, level);
      const note = res.ok ? '' : `\n${describePlayerError(res)}`;
      await replyEphemeral(interaction, `🔊 Volume set to **${level}**.${note}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to set volume.';
      await replyEphemeral(interaction, msg);
    }
  },
};
