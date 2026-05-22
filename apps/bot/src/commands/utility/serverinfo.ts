import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';

/**
 * /serverinfo — render a rich embed describing the current guild.
 *
 * All data is read from the cached `interaction.guild` plus a fresh `fetch()`
 * so member counts and presence counts are accurate. Online count requires
 * presence intent; if not present we omit the field rather than show 0.
 */
export const serverinfo: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show detailed information about this server.')
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'This command must be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const g = interaction.guild;
    await g.fetch();
    const owner = await g.fetchOwner().catch(() => null);

    const channels = g.channels.cache;
    const textChannels = channels.filter((c) => c.type === ChannelType.GuildText).size;
    const voiceChannels = channels.filter((c) => c.type === ChannelType.GuildVoice).size;
    const forumChannels = channels.filter((c) => c.type === ChannelType.GuildForum).size;
    const stageChannels = channels.filter((c) => c.type === ChannelType.GuildStageVoice).size;
    const announcementChannels = channels.filter((c) => c.type === ChannelType.GuildAnnouncement).size;
    const categoryChannels = channels.filter((c) => c.type === ChannelType.GuildCategory).size;

    // approximatePresenceCount is only populated when the guild was fetched
    // with `with_counts=true`. discord.js does this on widget-style fetches,
    // but the in-process cache may not. We expose what we have.
    const onlineCount = g.approximatePresenceCount ?? null;

    const featureList = g.features.length > 0
      ? g.features.map((f) => `\`${f}\``).join(', ').slice(0, 1024)
      : 'None';

    const embed = new EmbedBuilder()
      .setTitle(g.name)
      .setColor(0x5865f2)
      .setThumbnail(g.iconURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: g.id, inline: true },
        { name: 'Owner', value: owner ? `${owner.user.tag} (<@${owner.id}>)` : 'Unknown', inline: true },
        { name: 'Created', value: time(g.createdAt, TimestampStyles.LongDate), inline: true },
        { name: 'Members', value: String(g.memberCount), inline: true },
        {
          name: 'Online',
          value: onlineCount !== null ? String(onlineCount) : 'Unknown',
          inline: true,
        },
        { name: 'Boosts', value: `Tier ${g.premiumTier} · ${g.premiumSubscriptionCount ?? 0}`, inline: true },
        { name: 'Text', value: String(textChannels), inline: true },
        { name: 'Voice', value: String(voiceChannels), inline: true },
        { name: 'Forum', value: String(forumChannels), inline: true },
        { name: 'Stage', value: String(stageChannels), inline: true },
        { name: 'Announcement', value: String(announcementChannels), inline: true },
        { name: 'Categories', value: String(categoryChannels), inline: true },
        { name: 'Roles', value: String(g.roles.cache.size), inline: true },
        { name: 'Emojis', value: String(g.emojis.cache.size), inline: true },
        { name: 'Stickers', value: String(g.stickers.cache.size), inline: true },
        { name: 'Features', value: featureList, inline: false },
      );

    if (g.bannerURL()) embed.setImage(g.bannerURL({ size: 1024 }));

    await interaction.reply({ embeds: [embed] });
  },
};
