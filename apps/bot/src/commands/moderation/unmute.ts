import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { buildModActionEmbed } from '../../util/mod-action-embed.js';
import { log } from '../../logger.js';

export const unmute: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a mute (native timeout or configured mute role).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Member to unmute.').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason.').setMaxLength(500)),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: 'That user is not in this server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const policy = await api.getWarningPolicy(interaction.guildId!).catch(() => null);
    const muteRoleId = policy?.muteRoleId ?? null;
    if (muteRoleId && member.roles.cache.has(muteRoleId)) {
      await member.roles.remove(muteRoleId, `${interaction.user.tag}: ${reason}`);
    }
    if (member.isCommunicationDisabled()) {
      await member.timeout(null, `${interaction.user.tag}: ${reason}`);
    }

    try {
      const { action } = await api.createModAction(interaction.guildId!, {
        type: 'UNMUTE',
        userId: target.id,
        moderatorId: interaction.user.id,
        reason,
      });
      await interaction.reply({ embeds: [buildModActionEmbed(action, target, interaction.user)] });
    } catch (err) {
      log.warn('Failed to log unmute', { err: err instanceof Error ? err.message : String(err) });
      const msg = err instanceof ApiError ? `Unmuted, but logging failed: ${err.message}` : 'Unmuted, but logging failed.';
      await interaction.reply({ content: msg });
    }
  },
};
