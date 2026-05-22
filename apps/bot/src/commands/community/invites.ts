import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const invites: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invite tracker: leaderboard, your stats, and gated roles.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription('Show the top inviters in this server.')
        .addIntegerOption((o) =>
          o
            .setName('limit')
            .setDescription('How many entries to show (1–25, default 10).')
            .setMinValue(1)
            .setMaxValue(25),
        ),
    )
    .addSubcommand((s) =>
      s.setName('me').setDescription('Show how many people you have invited.'),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('gate')
        .setDescription('Manage invite-gated role assignments (ManageGuild).')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Auto-assign a role to members who join via an invite code.')
            .addStringOption((o) =>
              o
                .setName('invite-code')
                .setDescription('The invite code (no discord.gg/ prefix).')
                .setRequired(true)
                .setMaxLength(32),
            )
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to assign.').setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Stop auto-assigning a role for an invite code.')
            .addStringOption((o) =>
              o
                .setName('invite-code')
                .setDescription('The invite code.')
                .setRequired(true)
                .setMaxLength(32),
            )
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role.').setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s.setName('list').setDescription('List configured invite-gated role rules.'),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === 'gate') {
        // Permission check for the group — Discord's setDefaultMemberPermissions
        // is per top-level command, so we enforce ManageGuild manually for the
        // gate group while leaving leaderboard/me open to all members.
        const perms = interaction.memberPermissions;
        if (!perms?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: 'You need Manage Server to manage invite-gated roles.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'add') {
          const code = interaction.options.getString('invite-code', true);
          const role = interaction.options.getRole('role', true);
          await api.upsertInviteGatedRole(interaction.guildId, {
            inviteCode: code,
            roleId: role.id,
          });
          await interaction.reply({
            content: `Members joining via \`${code}\` will receive ${role.toString()}.`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        if (sub === 'remove') {
          const code = interaction.options.getString('invite-code', true);
          const role = interaction.options.getRole('role', true);
          const { rules } = await api.listInviteGatedRoles(interaction.guildId);
          const match = rules.find((r) => r.inviteCode === code && r.roleId === role.id);
          if (!match) {
            await interaction.reply({
              content: 'No matching rule found.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await api.deleteInviteGatedRole(interaction.guildId, match.id);
          await interaction.reply({
            content: `Removed gated role for \`${code}\`.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (sub === 'list') {
          const { rules } = await api.listInviteGatedRoles(interaction.guildId);
          if (rules.length === 0) {
            await interaction.reply({
              content: 'No invite-gated roles configured.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const embed = new EmbedBuilder()
            .setTitle('Invite-gated roles')
            .setColor(0x5865f2)
            .setDescription(
              rules
                .map((r) => `\`${r.inviteCode}\` → <@&${r.roleId}>`)
                .join('\n'),
            );
          await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }
      }

      if (sub === 'leaderboard') {
        const limit = interaction.options.getInteger('limit') ?? 10;
        const { entries } = await api.inviteLeaderboard(interaction.guildId, limit);
        if (entries.length === 0) {
          await interaction.reply({
            content: 'No tracked invites yet.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = entries.map(
          (e, i) =>
            `**${i + 1}.** <@${e.inviterId}> — ${e.real} real (${e.fake} fake, ${e.total} total)`,
        );
        const embed = new EmbedBuilder()
          .setTitle('Invite leaderboard')
          .setColor(0x5865f2)
          .setDescription(lines.join('\n'));
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (sub === 'me') {
        const stats = await api.inviteStatsForUser(interaction.guildId, interaction.user.id);
        await interaction.reply({
          content: `You have invited **${stats.real}** members (${stats.fake} fake, ${stats.total} total).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) return;
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
