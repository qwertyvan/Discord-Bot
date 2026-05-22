import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { describePlayerError, musicPlayer } from '../../util/music-player.js';
import { replyEphemeral, requireVoice } from '../../util/music-voice.js';

export const pause: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the currently-playing track.')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const voice = await requireVoice(interaction, { requireSameAsBot: true });
    if (!voice.ok) {
      await replyEphemeral(interaction, voice.reply);
      return;
    }
    const res = await musicPlayer.pause(interaction.guildId);
    if (!res.ok) {
      await replyEphemeral(interaction, describePlayerError(res));
      return;
    }
    await replyEphemeral(interaction, '⏸️ Paused.');
  },
};

export const resume: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playback.')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const voice = await requireVoice(interaction, { requireSameAsBot: true });
    if (!voice.ok) {
      await replyEphemeral(interaction, voice.reply);
      return;
    }
    const res = await musicPlayer.resume(interaction.guildId);
    if (!res.ok) {
      await replyEphemeral(interaction, describePlayerError(res));
      return;
    }
    await replyEphemeral(interaction, '▶️ Resumed.');
  },
};
