import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { suggestionMessagePayload } from '../../util/suggestion-render.js';

export const suggest: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Submit a suggestion to the configured suggestions channel.')
    .setContexts(0)
    .addStringOption((o) =>
      o
        .setName('content')
        .setDescription('Your suggestion.')
        .setRequired(true)
        .setMaxLength(2000),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to post the suggestion in (defaults to this channel).')
        .addChannelTypes(ChannelType.GuildText),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const content = interaction.options.getString('content', true);
    const channel = (interaction.options.getChannel('channel') ?? interaction.channel) as
      | TextChannel
      | null;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Pick a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const created = await api.createSuggestion(interaction.guildId, {
        channelId: channel.id,
        authorId: interaction.user.id,
        content,
      });
      const payload = suggestionMessagePayload(created);
      const message = await channel.send(payload);
      await api.updateSuggestion(interaction.guildId, created.id, { messageId: message.id });
      await interaction.editReply(`💡 Suggestion posted in ${channel}.`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.editReply(msg);
    }
  },
};

export const suggestReview: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('suggest-review')
    .setDescription('Set the status of a suggestion.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(0)
    .addStringOption((o) =>
      o.setName('id').setDescription('Suggestion ID.').setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('status')
        .setDescription('New status.')
        .setRequired(true)
        .addChoices(
          { name: 'open', value: 'open' },
          { name: 'accepted', value: 'accepted' },
          { name: 'rejected', value: 'rejected' },
          { name: 'implemented', value: 'implemented' },
        ),
    )
    .addStringOption((o) =>
      o.setName('note').setDescription('Optional note for the suggestion author.').setMaxLength(500),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const id = interaction.options.getString('id', true);
    const status = interaction.options.getString('status', true) as
      | 'open'
      | 'accepted'
      | 'rejected'
      | 'implemented';
    const note = interaction.options.getString('note') ?? undefined;
    try {
      const updated = await api.reviewSuggestion(interaction.guildId, id, {
        status,
        reviewedBy: interaction.user.id,
        ...(note ? { reviewNote: note } : {}),
      });
      // Update the original message.
      if (updated.messageId && updated.channelId) {
        const channel = interaction.guild.channels.cache.get(updated.channelId);
        if (channel && channel.type === ChannelType.GuildText) {
          const message = await (channel as TextChannel).messages
            .fetch(updated.messageId)
            .catch(() => null);
          if (message) await message.edit(suggestionMessagePayload(updated)).catch(() => {});
        }
      }
      await interaction.reply({
        content: `Suggestion \`${id}\` marked **${status}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
