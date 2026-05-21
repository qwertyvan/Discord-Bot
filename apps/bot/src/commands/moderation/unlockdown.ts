import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const unlockdown: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unlockdown')
    .setDescription('Restore @everyone send-messages permission in this channel (or every channel).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(0)
    .addBooleanOption((o) => o.setName('all').setDescription('Unlock every text channel.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const all = interaction.options.getBoolean('all') ?? false;
    const everyone = interaction.guild.roles.everyone;
    const reason = `Unlock by ${interaction.user.tag}`;

    if (all) {
      await interaction.deferReply();
      const channels = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildText && c.manageable,
      );
      let unlocked = 0;
      for (const channel of channels.values()) {
        if (!('permissionOverwrites' in channel)) continue;
        try {
          await channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason });
          unlocked++;
        } catch {
          // ignore
        }
      }
      await interaction.editReply(`🔓 Unlocked **${unlocked}** channel${unlocked === 1 ? '' : 's'}.`);
      return;
    }

    const channel = interaction.channel;
    if (!channel || !('permissionOverwrites' in channel)) {
      await interaction.reply({ content: 'This channel does not support unlockdown.', flags: MessageFlags.Ephemeral });
      return;
    }
    await channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason });
    await interaction.reply('🔓 Channel unlocked.');
  },
};
