import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const purge: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete the last N messages from this channel (1–100).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(0)
    .addIntegerOption((o) =>
      o
        .setName('count')
        .setDescription('Number of messages to delete (1–100).')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.channel) return;
    const channel = interaction.channel;
    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement &&
      channel.type !== ChannelType.PublicThread &&
      channel.type !== ChannelType.PrivateThread
    ) {
      await interaction.reply({ content: 'This channel does not support bulk delete.', flags: MessageFlags.Ephemeral });
      return;
    }
    const count = interaction.options.getInteger('count', true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const deleted = await channel.bulkDelete(count, true);
    await interaction.editReply(
      `🧹 Deleted **${deleted.size}** message${deleted.size === 1 ? '' : 's'}. (Messages older than 14 days are skipped.)`,
    );
  },
};
