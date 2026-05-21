import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
  ChannelType,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';

export const serverinfo: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show information about this server.')
    .setContexts(0), // Guild-only
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const g = interaction.guild;
    await g.fetch();
    const channels = g.channels.cache;
    const textChannels = channels.filter((c) => c.type === ChannelType.GuildText).size;
    const voiceChannels = channels.filter((c) => c.type === ChannelType.GuildVoice).size;
    const owner = await g.fetchOwner();

    const embed = new EmbedBuilder()
      .setTitle(g.name)
      .setThumbnail(g.iconURL({ size: 256 }))
      .setColor(0x5865f2)
      .addFields(
        { name: 'ID', value: g.id, inline: true },
        { name: 'Owner', value: owner.user.tag, inline: true },
        { name: 'Members', value: String(g.memberCount), inline: true },
        { name: 'Text channels', value: String(textChannels), inline: true },
        { name: 'Voice channels', value: String(voiceChannels), inline: true },
        { name: 'Roles', value: String(g.roles.cache.size), inline: true },
        { name: 'Created', value: time(g.createdAt, TimestampStyles.LongDate), inline: false },
      );
    await interaction.reply({ embeds: [embed] });
  },
};
