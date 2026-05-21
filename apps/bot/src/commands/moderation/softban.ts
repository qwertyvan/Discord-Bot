import {
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { checkModerationHierarchy } from './_hierarchy.js';
import { buildModActionEmbed } from '../../util/mod-action-embed.js';
import { log } from '../../logger.js';

/**
 * Soft-ban: ban + immediately unban. Discord deletes the user's recent
 * messages but the user can rejoin. Useful for clearing spam without the
 * permanence of a ban.
 */
export const softban: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('softban')
    .setDescription('Ban + immediately unban a member to clear their recent messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Member to soft-ban.').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason.').setMaxLength(500))
    .addIntegerOption((o) =>
      o.setName('delete_days').setDescription('Days of messages to delete (default 1).').setMinValue(1).setMaxValue(7),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const deleteDays = interaction.options.getInteger('delete_days') ?? 1;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: 'That user is not in this server.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!(interaction.member instanceof GuildMember)) {
      await interaction.reply({ content: 'Could not resolve your member record.', flags: MessageFlags.Ephemeral });
      return;
    }
    const hierarchyError = checkModerationHierarchy(interaction.member, member);
    if (hierarchyError) {
      await interaction.reply({ content: hierarchyError, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!member.bannable) {
      await interaction.reply({
        content: 'I cannot ban that user (role hierarchy or missing permission for the bot).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.guild.bans.create(target.id, {
      reason: `${interaction.user.tag} [softban]: ${reason}`,
      deleteMessageSeconds: deleteDays * 86400,
    });
    await interaction.guild.bans.remove(target.id, `softban — auto-unban`).catch(() => {});

    try {
      const { action } = await api.createModAction(interaction.guildId!, {
        type: 'SOFTBAN',
        userId: target.id,
        moderatorId: interaction.user.id,
        reason,
      });
      await interaction.reply({ embeds: [buildModActionEmbed(action, target, interaction.user)] });
    } catch (err) {
      log.warn('Failed to log softban', { err: err instanceof Error ? err.message : String(err) });
      const msg = err instanceof ApiError ? `Soft-banned, but logging failed: ${err.message}` : 'Soft-banned, but logging failed.';
      await interaction.reply({ content: msg });
    }
  },
};
