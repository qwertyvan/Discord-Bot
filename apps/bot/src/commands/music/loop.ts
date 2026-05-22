import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { replyEphemeral, requireVoice } from '../../util/music-voice.js';
import type { LoopMode } from '@discord-bot/shared';

export const loop: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the loop mode for the music queue.')
    .setContexts(0)
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('off · track · queue')
        .setRequired(true)
        .addChoices(
          { name: 'off', value: 'off' },
          { name: 'track', value: 'track' },
          { name: 'queue', value: 'queue' },
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const voice = await requireVoice(interaction);
    if (!voice.ok) {
      await replyEphemeral(interaction, voice.reply);
      return;
    }
    const mode = interaction.options.getString('mode', true) as LoopMode;
    try {
      await api.setLoopMode(interaction.guildId, mode);
      await replyEphemeral(interaction, `🔁 Loop mode set to **${mode}**.`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to update loop mode.';
      await replyEphemeral(interaction, msg);
    }
  },
};
