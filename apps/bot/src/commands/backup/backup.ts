import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export const backup: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Manage configuration snapshots for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('snapshot')
        .setDescription('Take a fresh snapshot of this server\'s configuration.')
        .addStringOption((o) =>
          o.setName('label').setDescription('Optional label for the snapshot.').setMaxLength(120),
        ),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('List existing snapshots, newest first.'),
    )
    .addSubcommand((s) =>
      s
        .setName('restore')
        .setDescription('Restore configuration from a snapshot. Replaces current config.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Snapshot ID (from /backup list).').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('auto')
        .setDescription('Enable or disable daily auto-snapshots.')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Turn auto-snapshots on or off.')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
        )
        .addIntegerOption((o) =>
          o
            .setName('retention_days')
            .setDescription('How many days of snapshots to keep (1-365, default 30).')
            .setMinValue(1)
            .setMaxValue(365),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'snapshot') {
        const rawLabel = interaction.options.getString('label')?.trim();
        const snap = await api.createSnapshot(interaction.guildId, {
          ...(rawLabel ? { label: rawLabel } : {}),
          createdBy: interaction.user.id,
        });
        await interaction.reply({
          content: `📦 Created snapshot \`${snap.id}\` — ${snap.label} (${formatBytes(
            snap.sizeBytes,
          )}).`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { snapshots } = await api.listSnapshots(interaction.guildId);
        if (snapshots.length === 0) {
          await interaction.reply({
            content: 'No snapshots yet. Run `/backup snapshot` to create one.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Configuration snapshots')
          .setColor(0x5865f2)
          .setFooter({ text: `${snapshots.length} total` });
        for (const s of snapshots.slice(0, 15)) {
          embed.addFields({
            name: `${s.label} · ${formatBytes(s.sizeBytes)}`,
            value: `${time(new Date(s.createdAt), TimestampStyles.RelativeTime)} · \`${s.id}\``,
          });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else if (sub === 'restore') {
        const id = interaction.options.getString('id', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await api.restoreSnapshot(interaction.guildId, id);
        const total = Object.values(result.tables).reduce((a, b) => a + b, 0);
        await interaction.editReply({
          content: `♻️ Restored snapshot \`${id}\` — ${total} rows across ${
            Object.keys(result.tables).length
          } tables.`,
        });
      } else if (sub === 'auto') {
        const mode = interaction.options.getString('mode', true);
        const retention = interaction.options.getInteger('retention_days') ?? undefined;
        const policy = await api.upsertSnapshotPolicy(interaction.guildId, {
          autoEnabled: mode === 'on',
          ...(retention !== undefined ? { retentionDays: retention } : {}),
        });
        await interaction.reply({
          content:
            mode === 'on'
              ? `⏱️ Daily auto-snapshots enabled. Keeping ${policy.retentionDays} days.`
              : '⏱️ Daily auto-snapshots disabled.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
