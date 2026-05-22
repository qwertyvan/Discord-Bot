import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { MessageContextCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

// Right-click → Apps → "Save quote". Records the message into the per-guild
// quote table after checking the guild's `savePermission` gate.
export const saveQuoteContext: MessageContextCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('Save quote')
    .setType(ApplicationCommandType.Message)
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.member) {
      await interaction.reply({
        content: 'Quotes only work inside a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const target = interaction.targetMessage;
    if (target.author.bot) {
      await interaction.reply({
        content: 'You can\'t save bot messages as quotes.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Pull config and gate.
    let cfg;
    try {
      cfg = await api.getQuoteConfig(interaction.guildId);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load quote config.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      return;
    }

    const member = interaction.member;
    const hasManageMessages =
      typeof member.permissions === 'string'
        ? false
        : member.permissions.has(PermissionFlagsBits.ManageMessages);

    if (cfg.savePermission === 'mods' && !hasManageMessages) {
      await interaction.reply({
        content: 'Only moderators can save quotes in this server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (cfg.savePermission === 'trusted-role') {
      const roleId = cfg.trustedRoleId;
      if (!roleId) {
        await interaction.reply({
          content: 'Quote saving is restricted but no trusted role is configured.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const rolesAny = (member as { roles: unknown }).roles;
      let hasRole = false;
      if (
        rolesAny &&
        typeof rolesAny === 'object' &&
        'cache' in rolesAny &&
        (rolesAny as { cache: { has(id: string): boolean } }).cache
      ) {
        hasRole = (rolesAny as { cache: { has(id: string): boolean } }).cache.has(roleId);
      } else if (Array.isArray(rolesAny)) {
        hasRole = (rolesAny as string[]).includes(roleId);
      }
      if (!hasRole && !hasManageMessages) {
        await interaction.reply({
          content: `You need the <@&${roleId}> role to save quotes.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // Build the quote payload.
    const content = (target.content || '').slice(0, 2000);
    if (!content && target.attachments.size === 0) {
      await interaction.reply({
        content: 'Nothing to quote — message has no text or attachments.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const firstAttachment = target.attachments.first();
    const reactionCount = target.reactions.cache.reduce((sum, r) => sum + r.count, 0);

    try {
      const quote = await api.createQuote(interaction.guildId, {
        sourceMessageId: target.id,
        sourceChannelId: target.channelId,
        authorId: target.author.id,
        savedBy: interaction.user.id,
        content: content || '(attachment)',
        ...(firstAttachment ? { attachmentUrl: firstAttachment.url.slice(0, 2048) } : {}),
        reactionCount,
      });
      await interaction.reply({
        content: `📝 Quote saved. \`${quote.id}\``,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await interaction.reply({
          content: 'That message is already saved as a quote.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const msg = err instanceof ApiError ? err.message : 'Failed to save quote.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
