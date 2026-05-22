import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import type { UpsertRetentionPolicyInput } from '@discord-bot/shared';

type RetentionTable =
  | 'mod-actions'
  | 'mod-logs'
  | 'transcripts'
  | 'snapshots'
  | 'audit-log';

const TABLE_TO_FIELD: Record<RetentionTable, keyof UpsertRetentionPolicyInput> = {
  'mod-actions': 'modActionsDays',
  'mod-logs': 'modLogsDays',
  transcripts: 'transcriptDays',
  snapshots: 'snapshotDays',
  'audit-log': 'auditLogDays',
};

export const retention: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('retention')
    .setDescription('Configure per-guild data retention policy.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('show').setDescription('Show this guild\'s retention policy.'),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set the retention horizon for a table (in days).')
        .addStringOption((o) =>
          o
            .setName('table')
            .setDescription('Which dataset to bound.')
            .setRequired(true)
            .addChoices(
              { name: 'mod-actions', value: 'mod-actions' },
              { name: 'mod-logs', value: 'mod-logs' },
              { name: 'transcripts', value: 'transcripts' },
              { name: 'snapshots', value: 'snapshots' },
              { name: 'audit-log', value: 'audit-log' },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName('days')
            .setDescription('Retention horizon in days. Use 0 to clear (no retention).')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(3650),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('redact-pii')
        .setDescription('Toggle PII redaction in audit-log dashboard reads.')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('on or off')
            .setRequired(true)
            .addChoices(
              { name: 'on', value: 'on' },
              { name: 'off', value: 'off' },
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'show') {
        const p = await api.getRetentionPolicy(interaction.guildId);
        const fmt = (n: number | null): string => (n == null ? 'unlimited' : `${n} days`);
        const embed = new EmbedBuilder()
          .setTitle('🗂️ Retention policy')
          .setColor(0x5865f2)
          .addFields(
            { name: 'mod-actions', value: fmt(p.modActionsDays), inline: true },
            { name: 'mod-logs', value: fmt(p.modLogsDays), inline: true },
            { name: 'transcripts', value: fmt(p.transcriptDays), inline: true },
            { name: 'snapshots', value: fmt(p.snapshotDays), inline: true },
            { name: 'audit-log', value: fmt(p.auditLogDays), inline: true },
            { name: 'redact PII', value: p.redactPii ? 'on' : 'off', inline: true },
          );
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'set') {
        const table = interaction.options.getString('table', true) as RetentionTable;
        const days = interaction.options.getInteger('days', true);
        const field = TABLE_TO_FIELD[table];
        // 0 → null (clear the horizon). The pruner will skip the table.
        const value = days === 0 ? null : days;
        await api.upsertRetentionPolicy(interaction.guildId, {
          [field]: value,
        } as UpsertRetentionPolicyInput);
        await interaction.reply({
          content:
            value == null
              ? `🗑️ Cleared retention for **${table}** (no horizon enforced).`
              : `✅ Retention for **${table}** set to **${value} days**.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'redact-pii') {
        const mode = interaction.options.getString('mode', true);
        await api.upsertRetentionPolicy(interaction.guildId, {
          redactPii: mode === 'on',
        });
        await interaction.reply({
          content:
            mode === 'on'
              ? '🕶️ PII redaction **enabled** — dashboard audit log will hash user IDs.'
              : '👀 PII redaction **disabled** — dashboard audit log will show full user IDs.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
