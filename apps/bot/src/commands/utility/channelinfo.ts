import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

function typeLabel(type: ChannelType): string {
  switch (type) {
    case ChannelType.GuildText:
      return 'Text';
    case ChannelType.GuildVoice:
      return 'Voice';
    case ChannelType.GuildCategory:
      return 'Category';
    case ChannelType.GuildAnnouncement:
      return 'Announcement';
    case ChannelType.GuildForum:
      return 'Forum';
    case ChannelType.GuildStageVoice:
      return 'Stage';
    case ChannelType.PublicThread:
      return 'Public thread';
    case ChannelType.PrivateThread:
      return 'Private thread';
    case ChannelType.AnnouncementThread:
      return 'Announcement thread';
    case ChannelType.GuildMedia:
      return 'Media';
    default:
      return `Type ${type}`;
  }
}

export const channelinfo: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('channelinfo')
    .setDescription('Show information about a channel.')
    .setContexts(0)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel to inspect (defaults to current).'),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'This command must be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel) {
      await interaction.reply({
        content: 'No channel resolved.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const live = interaction.guild.channels.cache.get(channel.id);
    if (!live) {
      await interaction.reply({
        content: 'Could not resolve that channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`#${live.name}`)
      .setColor(0x5865f2)
      .addFields(
        { name: 'ID', value: live.id, inline: true },
        { name: 'Type', value: typeLabel(live.type), inline: true },
      );

    if (live.parent) {
      embed.addFields({ name: 'Category', value: live.parent.name, inline: true });
    }
    if (live.createdAt) {
      embed.addFields({
        name: 'Created',
        value: time(live.createdAt, TimestampStyles.LongDate),
        inline: true,
      });
    }

    // Text/announcement specifics: topic, slowmode, NSFW.
    if (live.type === ChannelType.GuildText || live.type === ChannelType.GuildAnnouncement) {
      const topic = live.topic ?? null;
      if (topic) embed.addFields({ name: 'Topic', value: topic.slice(0, 1024), inline: false });
      embed.addFields(
        { name: 'NSFW', value: live.nsfw ? 'Yes' : 'No', inline: true },
        { name: 'Slowmode', value: `${live.rateLimitPerUser ?? 0}s`, inline: true },
      );
    }
    if (live.type === ChannelType.GuildForum) {
      if (live.topic) embed.addFields({ name: 'Guidelines', value: live.topic.slice(0, 1024), inline: false });
      embed.addFields({
        name: 'Slowmode',
        value: `${live.rateLimitPerUser ?? 0}s`,
        inline: true,
      });
    }
    if (live.type === ChannelType.GuildVoice || live.type === ChannelType.GuildStageVoice) {
      embed.addFields(
        { name: 'Bitrate', value: `${Math.round((live.bitrate ?? 0) / 1000)} kbps`, inline: true },
        { name: 'User limit', value: live.userLimit ? String(live.userLimit) : 'Unlimited', inline: true },
      );
    }

    // Best-effort: pull v0.23 insights and surface the recent message count
    // for this channel if it appears in the top-channels list. We don't fail
    // the command if insights aren't enabled or the channel isn't in the
    // hot-list — the field is just omitted.
    try {
      const insights = await api.getInsights(interaction.guild.id, 7);
      const hit = insights.topChannels.find((c) => c.channelId === live.id);
      if (hit) {
        embed.addFields({
          name: 'Activity (7d)',
          value: `${hit.messages} messages`,
          inline: true,
        });
      }
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) {
        // Non-fatal: insights may not be available.
      }
    }

    await interaction.reply({ embeds: [embed] });
  },
};
