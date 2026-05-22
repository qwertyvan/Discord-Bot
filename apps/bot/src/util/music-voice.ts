import {
  type ChatInputCommandInteraction,
  type GuildMember,
  MessageFlags,
} from 'discord.js';

export interface VoiceCheckOk {
  ok: true;
  voiceChannelId: string;
}

export interface VoiceCheckFail {
  ok: false;
  reply: string;
}

/**
 * Confirm the invoking member is in a voice channel. Some commands (skip /
 * pause / etc.) additionally require that the bot is already in the same
 * voice channel — pass `requireSameAsBot: true` for those.
 */
export async function requireVoice(
  interaction: ChatInputCommandInteraction,
  options: { requireSameAsBot?: boolean } = {},
): Promise<VoiceCheckOk | VoiceCheckFail> {
  if (!interaction.inGuild() || !interaction.guild) {
    return { ok: false, reply: 'Music commands work in servers only.' };
  }
  const member = interaction.member as GuildMember | null;
  const userChannelId = member?.voice?.channelId ?? null;
  if (!userChannelId) {
    return { ok: false, reply: 'You must be in a voice channel to use this command.' };
  }
  if (options.requireSameAsBot) {
    const botMember = interaction.guild.members.me;
    const botChannelId = botMember?.voice?.channelId ?? null;
    if (botChannelId && botChannelId !== userChannelId) {
      return {
        ok: false,
        reply: 'You need to be in the same voice channel as the bot for this command.',
      };
    }
  }
  return { ok: true, voiceChannelId: userChannelId };
}

export async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
