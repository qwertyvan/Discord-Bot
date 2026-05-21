import {
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { checkModerationHierarchy } from './_hierarchy.js';

export const warn: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning to a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Member to warn.').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Reason for the warning.')
        .setRequired(true)
        .setMaxLength(500),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);

    if (target.bot) {
      await interaction.reply({ content: 'You cannot warn a bot.', flags: MessageFlags.Ephemeral });
      return;
    }

    const targetMember = interaction.guild
      ? await interaction.guild.members.fetch(target.id).catch(() => null)
      : null;
    if (targetMember && interaction.member instanceof GuildMember) {
      const hierarchyError = checkModerationHierarchy(interaction.member, targetMember);
      if (hierarchyError) {
        await interaction.reply({ content: hierarchyError, flags: MessageFlags.Ephemeral });
        return;
      }
    } else if (target.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot warn yourself.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const warning = await api.createWarning(interaction.guildId, {
        userId: target.id,
        moderatorId: interaction.user.id,
        reason,
      });

      const embed = new EmbedBuilder()
        .setTitle('Warning issued')
        .setColor(0xfaa61a)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: 'User', value: `${target} (\`${target.id}\`)` },
          { name: 'Moderator', value: `${interaction.user}` },
          { name: 'Reason', value: reason },
          { name: 'Warning ID', value: `\`${warning.id}\`` },
        )
        .setTimestamp(new Date(warning.createdAt));
      await interaction.reply({ embeds: [embed] });

      // Best-effort DM.
      await target
        .send(
          `You were warned in **${interaction.guild?.name}**.\n**Reason:** ${reason}`,
        )
        .catch(() => {});
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Failed to record warning: ${err.message}`
          : 'Failed to record warning.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
