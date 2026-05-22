import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { invalidateStickyCache } from '../../events/sticky.js';

export const sticky: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Manage the sticky message for this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set or update the sticky message for this channel.')
        .addStringOption((o) =>
          o.setName('content').setDescription('Message to keep at the bottom.').setRequired(true).setMaxLength(2000),
        )
        .addIntegerOption((o) =>
          o
            .setName('after_messages')
            .setDescription('Repost the sticky after this many user messages (default 5).')
            .setMinValue(1)
            .setMaxValue(500),
        ),
    )
    .addSubcommand((s) =>
      s.setName('show').setDescription('Show the current sticky message for this channel.'),
    )
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Remove the sticky message from this channel.'),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.channel) return;
    if (interaction.channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Sticky messages work in text channels only.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'set') {
        const content = interaction.options.getString('content', true);
        const throttle = interaction.options.getInteger('after_messages') ?? undefined;
        await api.upsertStickyMessage(interaction.guildId, {
          channelId: interaction.channel.id,
          content,
          ...(throttle !== undefined ? { throttleMessages: throttle } : {}),
          enabled: true,
        });
        invalidateStickyCache(interaction.guildId, interaction.channel.id);
        await interaction.reply({
          content: `📌 Sticky message set. Will re-post every ${throttle ?? 5} messages.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'show') {
        const s = await api.getStickyMessage(interaction.guildId, interaction.channel.id);
        await interaction.reply({
          content: `**Sticky** (re-posts every ${s.throttleMessages} messages, ${
            s.enabled ? 'enabled' : 'disabled'
          }):\n${s.content}`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'remove') {
        await api.deleteStickyMessage(interaction.guildId, interaction.channel.id);
        invalidateStickyCache(interaction.guildId, interaction.channel.id);
        await interaction.reply({
          content: '🗑️ Sticky removed.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
