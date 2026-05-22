import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { invalidateForumTagCache } from '../../events/threadCreate.js';

export const forumTag: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('forum-tag')
    .setDescription('Manage keyword-to-tag rules for forum channels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a keyword-to-tag rule for a forum channel.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Forum channel.')
            .addChannelTypes(ChannelType.GuildForum)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('keyword')
            .setDescription('Substring to match in the first message (case-insensitive).')
            .setRequired(true)
            .setMaxLength(120),
        )
        .addStringOption((o) =>
          o
            .setName('tag')
            .setDescription('Forum tag ID to apply.')
            .setRequired(true)
            .setMaxLength(40),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a forum-tag rule.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Rule ID.').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List forum auto-tag rules.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'add') {
        const channel = interaction.options.getChannel('channel', true);
        const keyword = interaction.options.getString('keyword', true).toLowerCase();
        const tagId = interaction.options.getString('tag', true);
        const created = await api.createForumTag(interaction.guildId, {
          channelId: channel.id,
          keyword,
          tagId,
        });
        invalidateForumTagCache(interaction.guildId, channel.id);
        await interaction.reply({
          content: `🏷️ Rule \`${created.id}\` added: when "${keyword}" appears in <#${channel.id}>, apply tag \`${tagId}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        const id = interaction.options.getString('id', true);
        // Best-effort cache invalidation: we don't know the channel id without
        // fetching, so clear all entries by listing.
        const before = await api.listForumTags(interaction.guildId).catch(() => null);
        await api.deleteForumTag(interaction.guildId, id);
        const match = before?.tags.find((t) => t.id === id);
        if (match) invalidateForumTagCache(interaction.guildId, match.channelId);
        await interaction.reply({
          content: `🗑️ Removed rule \`${id}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { tags } = await api.listForumTags(interaction.guildId);
        if (tags.length === 0) {
          await interaction.reply({
            content: 'No forum auto-tag rules.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Forum auto-tag rules')
          .setColor(0x5865f2)
          .setFooter({ text: `${tags.length} rule${tags.length === 1 ? '' : 's'}` });
        for (const t of tags.slice(0, 25)) {
          embed.addFields({
            name: `<#${t.channelId}> · "${t.keyword}"`,
            value: `→ tag \`${t.tagId}\`\n\`${t.id}\``,
          });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
