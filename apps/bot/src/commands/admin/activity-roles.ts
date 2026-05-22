import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const activityRole: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('activity-role')
    .setDescription('Activity-based role rules (grant/revoke roles by recent activity).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add an activity-role rule.')
        .addRoleOption((o) =>
          o.setName('role').setDescription('Role to grant or revoke.').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Whether the rule grants the role or revokes it.')
            .setRequired(true)
            .addChoices(
              { name: 'grant', value: 'grant' },
              { name: 'revoke', value: 'revoke' },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName('min_messages')
            .setDescription('Minimum messages over the window. Default 0.')
            .setMinValue(0)
            .setMaxValue(1_000_000),
        )
        .addIntegerOption((o) =>
          o
            .setName('min_voice_minutes')
            .setDescription('Minimum voice minutes over the window. Default 0.')
            .setMinValue(0)
            .setMaxValue(1_000_000),
        )
        .addIntegerOption((o) =>
          o
            .setName('window_days')
            .setDescription('Activity window in days (1–365). Default 30.')
            .setMinValue(1)
            .setMaxValue(365),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove an activity-role rule by id.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Rule id (from /activity-role list).').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('Show all activity-role rules in this server.'),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'add') {
        const role = interaction.options.getRole('role', true);
        const action = interaction.options.getString('action', true) as 'grant' | 'revoke';
        const minMessages = interaction.options.getInteger('min_messages') ?? 0;
        const minVoiceMinutes = interaction.options.getInteger('min_voice_minutes') ?? 0;
        const windowDays = interaction.options.getInteger('window_days') ?? 30;

        if (minMessages === 0 && minVoiceMinutes === 0) {
          await interaction.reply({
            content: 'Set at least one of `min_messages` or `min_voice_minutes`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const rule = await api.createActivityRule(interaction.guildId, {
          roleId: role.id,
          action,
          minMessages,
          minVoiceMinutes,
          windowDays,
          enabled: true,
        });
        await interaction.reply({
          content:
            `✅ Rule created: \`${rule.id}\` — ${action} <@&${rule.roleId}> when ` +
            `≥${rule.minMessages} msgs / ≥${rule.minVoiceMinutes}min voice over ${rule.windowDays}d.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (sub === 'remove') {
        const id = interaction.options.getString('id', true);
        await api.deleteActivityRule(interaction.guildId, id);
        await interaction.reply({
          content: `🗑️ Rule \`${id}\` removed.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'list') {
        const { rules } = await api.listActivityRules(interaction.guildId);
        if (rules.length === 0) {
          await interaction.reply({
            content: 'No activity-role rules configured.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Activity-role rules')
          .setColor(0x5865f2)
          .setDescription(
            rules
              .map(
                (r) =>
                  `• \`${r.id}\` — **${r.action}** <@&${r.roleId}>` +
                  `\n   ≥${r.minMessages} msgs / ≥${r.minVoiceMinutes}min voice / ${r.windowDays}d` +
                  (r.enabled ? '' : ' _(disabled)_'),
              )
              .join('\n\n'),
          );
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Command failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
