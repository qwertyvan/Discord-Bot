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

export const ban: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('User to ban.').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for ban.').setMaxLength(500))
    .addIntegerOption((o) =>
      o.setName('delete_days').setDescription("Days of recent messages to delete (0–7).").setMinValue(0).setMaxValue(7),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member) {
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
    }

    await interaction.guild.bans.create(target.id, {
      reason: `${interaction.user.tag}: ${reason}`,
      deleteMessageSeconds: deleteDays * 86400,
    });
    try {
      const { action } = await api.createModAction(interaction.guildId!, {
        type: 'BAN',
        userId: target.id,
        moderatorId: interaction.user.id,
        reason,
      });
      await interaction.reply({ embeds: [buildModActionEmbed(action, target, interaction.user)] });
    } catch (err) {
      log.warn('Failed to log ban to API', { err: err instanceof Error ? err.message : String(err) });
      const msg = err instanceof ApiError ? `Banned, but failed to log: ${err.message}` : 'Banned, but logging failed.';
      await interaction.reply({ content: msg });
    }
  },
};
