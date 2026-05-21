import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api } from '../../api-client.js';
import { log } from '../../logger.js';

export const masskick: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('masskick')
    .setDescription('Kick every member with a specific role.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setContexts(0)
    .addRoleOption((o) => o.setName('role').setDescription('Role whose members to kick.').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason.').setMaxLength(500)),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const role = interaction.options.getRole('role', true);
    const reason = interaction.options.getString('reason') ?? 'Masskick';

    if (role.id === interaction.guild.id) {
      await interaction.reply({ content: 'Refusing to kick @everyone.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    await interaction.guild.members.fetch();

    const targets = interaction.guild.members.cache
      .filter((m) => m.roles.cache.has(role.id) && m.kickable && !m.user.bot)
      .first(200);

    if (targets.length === 0) {
      await interaction.editReply('No kickable members hold that role.');
      return;
    }

    const auditReason = `${interaction.user.tag} [masskick]: ${reason}`;
    let kicked = 0;
    let failed = 0;
    for (const member of targets) {
      try {
        await member.kick(auditReason);
        await api
          .createModAction(interaction.guildId!, {
            type: 'KICK',
            userId: member.id,
            moderatorId: interaction.user.id,
            reason,
          })
          .catch((err) => log.warn('Masskick: failed to log', { id: member.id, err: String(err) }));
        kicked++;
      } catch (err) {
        log.warn('Masskick: kick failed', { id: member.id, err: String(err) });
        failed++;
      }
    }
    await interaction.editReply(`🥾 Masskick: **${kicked}** kicked, **${failed}** failed.`);
  },
};
