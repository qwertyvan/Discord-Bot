import {
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { checkModerationHierarchy } from './_hierarchy.js';

export const kick: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Member to kick.').setRequired(true))
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for kick.').setMaxLength(500),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const target = interaction.options.getUser('user', true);
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
    if (!member.kickable) {
      await interaction.reply({
        content: 'I cannot kick that user (role hierarchy or missing permission for the bot).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await member.kick(`${interaction.user.tag}: ${reason}`);

    const embed = new EmbedBuilder()
      .setTitle('Member kicked')
      .setColor(0xed4245)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'User', value: `${target} (\`${target.id}\`)` },
        { name: 'Moderator', value: `${interaction.user}` },
        { name: 'Reason', value: reason },
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};
