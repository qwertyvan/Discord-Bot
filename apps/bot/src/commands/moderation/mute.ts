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
import { parseDuration } from '../../util/duration.js';
import { log } from '../../logger.js';

const MAX_TIMEOUT_MS = 28 * 86_400_000;

/**
 * Mute applies Discord's native timeout when a mute role isn't configured.
 * If the guild's WarningPolicy.muteRoleId is set, the bot uses that role
 * instead (useful for servers that prefer permanent text mutes).
 */
export const mute: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a member (native timeout or configured mute role).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Member to mute.').setRequired(true))
    .addStringOption((o) =>
      o.setName('duration').setDescription('Duration, e.g. 10m, 1h, 2d. Omit for indefinite (mute-role mode only).'),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Reason.').setMaxLength(500)),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const target = interaction.options.getUser('user', true);
    const rawDuration = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

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

    let durationMs: number | null = null;
    if (rawDuration) {
      durationMs = parseDuration(rawDuration);
      if (durationMs === null) {
        await interaction.reply({ content: 'Invalid duration. Use formats like `10m`, `1h`, `2d`.', flags: MessageFlags.Ephemeral });
        return;
      }
    }

    const policy = await api.getWarningPolicy(interaction.guildId!).catch(() => null);
    const muteRoleId = policy?.muteRoleId ?? null;

    if (muteRoleId) {
      const role = interaction.guild.roles.cache.get(muteRoleId);
      if (!role) {
        await interaction.reply({
          content: 'Configured mute role no longer exists. Update the policy in the dashboard.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await member.roles.add(role, `${interaction.user.tag}: ${reason}`);
    } else {
      // Native timeout path.
      const duration = Math.min(durationMs ?? 60 * 60 * 1000, MAX_TIMEOUT_MS);
      if (!member.moderatable) {
        await interaction.reply({
          content: 'I cannot moderate that user. Configure a mute role for non-timeout-able members.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await member.timeout(duration, `${interaction.user.tag}: ${reason}`);
      durationMs = duration;
    }

    try {
      const { action } = await api.createModAction(interaction.guildId!, {
        type: 'MUTE',
        userId: target.id,
        moderatorId: interaction.user.id,
        reason,
        ...(durationMs ? { durationMs, expiresAt: new Date(Date.now() + durationMs).toISOString() } : {}),
      });
      await interaction.reply({ embeds: [buildModActionEmbed(action, target, interaction.user)] });
    } catch (err) {
      log.warn('Failed to log mute', { err: err instanceof Error ? err.message : String(err) });
      const msg = err instanceof ApiError ? `Muted, but logging failed: ${err.message}` : 'Muted, but logging failed.';
      await interaction.reply({ content: msg });
    }
  },
};
