import {
  ChannelType,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { checkModerationHierarchy } from '../moderation/_hierarchy.js';
import { buildModActionEmbed } from '../../util/mod-action-embed.js';
import { log } from '../../logger.js';

const DEFAULT_MUTE_MS = 60 * 60 * 1000; // 1 hour

export const reports: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('reports')
    .setDescription('Manage the per-guild report queue.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Show recent reports in this guild.')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Filter by status (default: open).')
            .addChoices(
              { name: 'open', value: 'open' },
              { name: 'reviewed', value: 'reviewed' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('View a single report.')
        .addStringOption((o) => o.setName('id').setDescription('Report ID.').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('review')
        .setDescription('Take an action on a report and close it.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Report ID.').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Action to take.')
            .setRequired(true)
            .addChoices(
              { name: 'warn', value: 'warn' },
              { name: 'mute', value: 'mute' },
              { name: 'delete', value: 'delete' },
              { name: 'dismiss', value: 'dismiss' },
            ),
        )
        .addStringOption((o) =>
          o.setName('note').setDescription('Optional review note.').setMaxLength(500),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const status = (interaction.options.getString('status') ?? 'open') as 'open' | 'reviewed';
      try {
        const { reports: items } = await api.listReports(interaction.guildId, {
          status,
          limit: 25,
        });
        if (items.length === 0) {
          await interaction.reply({
            content: `No \`${status}\` reports.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = items.map((r) => {
          const created = new Date(r.createdAt).toLocaleString('en-US', { hour12: false });
          const msgLink = r.targetMessageId
            ? `[jump](https://discord.com/channels/${r.guildId}/${r.channelId}/${r.targetMessageId})`
            : `<#${r.channelId}>`;
          const tag = r.status === 'open' ? '🟡' : `✅(${r.actionTaken ?? '—'})`;
          return `${tag} \`${r.id.slice(0, 8)}\` · <@${r.targetUserId}> · ${msgLink} · ${created}`;
        });
        const embed = new EmbedBuilder()
          .setTitle(`Reports (${status})`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `Showing ${items.length} report(s)` });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Failed to list reports.';
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'view') {
      const id = interaction.options.getString('id', true);
      try {
        const r = await api.getReport(interaction.guildId, id);
        const created = new Date(r.createdAt).toLocaleString('en-US', { hour12: false });
        const embed = new EmbedBuilder()
          .setTitle(`Report ${r.id.slice(0, 8)}`)
          .addFields(
            { name: 'Status', value: r.status, inline: true },
            { name: 'Reporter', value: `<@${r.reporterId}>`, inline: true },
            { name: 'Target', value: `<@${r.targetUserId}>`, inline: true },
            { name: 'Channel', value: `<#${r.channelId}>`, inline: true },
            {
              name: 'Message',
              value: r.targetMessageId
                ? `[jump](https://discord.com/channels/${r.guildId}/${r.channelId}/${r.targetMessageId})`
                : '—',
              inline: true,
            },
            { name: 'Created', value: created, inline: true },
            {
              name: 'Reported content',
              value: r.content.length > 0 ? r.content.slice(0, 1000) : '_(empty)_',
            },
          );
        if (r.status === 'reviewed') {
          embed.addFields(
            { name: 'Action taken', value: r.actionTaken ?? '—', inline: true },
            { name: 'Reviewed by', value: r.reviewedBy ? `<@${r.reviewedBy}>` : '—', inline: true },
            { name: 'Review note', value: r.reviewNote ?? '—' },
          );
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Failed to fetch report.';
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'review') {
      const id = interaction.options.getString('id', true);
      const action = interaction.options.getString('action', true) as
        | 'warn'
        | 'mute'
        | 'delete'
        | 'dismiss';
      const note = interaction.options.getString('note') ?? undefined;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let report;
      try {
        report = await api.getReport(interaction.guildId, id);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Failed to fetch report.';
        await interaction.editReply(msg);
        return;
      }
      if (report.status === 'reviewed') {
        await interaction.editReply(`That report is already reviewed (action: ${report.actionTaken ?? '—'}).`);
        return;
      }

      const reasonForAction = note ?? `Report ${report.id.slice(0, 8)}`;

      try {
        if (action === 'warn') {
          // Hierarchy guard against the moderator.
          if (interaction.member instanceof GuildMember) {
            const tgt = await interaction.guild.members.fetch(report.targetUserId).catch(() => null);
            if (tgt) {
              const err = checkModerationHierarchy(interaction.member, tgt);
              if (err) {
                await interaction.editReply(err);
                return;
              }
            }
          }
          const { action: modAction } = await api.createModAction(interaction.guildId, {
            type: 'WARN',
            userId: report.targetUserId,
            moderatorId: interaction.user.id,
            reason: reasonForAction,
          });
          await api.reviewReport(interaction.guildId, report.id, {
            action,
            reviewerId: interaction.user.id,
            ...(note ? { note } : {}),
          });
          const targetUser = await interaction.client.users
            .fetch(report.targetUserId)
            .catch(() => null);
          if (targetUser) {
            await interaction.editReply({
              embeds: [buildModActionEmbed(modAction, targetUser, interaction.user)],
            });
          } else {
            await interaction.editReply(`✅ Warned <@${report.targetUserId}> (case #${modAction.caseNumber}).`);
          }
          return;
        }

        if (action === 'mute') {
          const tgtMember = await interaction.guild.members
            .fetch(report.targetUserId)
            .catch(() => null);
          if (!tgtMember) {
            await interaction.editReply('Target is not in this guild — cannot mute.');
            return;
          }
          if (interaction.member instanceof GuildMember) {
            const err = checkModerationHierarchy(interaction.member, tgtMember);
            if (err) {
              await interaction.editReply(err);
              return;
            }
          }
          if (!tgtMember.moderatable) {
            await interaction.editReply('I cannot timeout that member (role hierarchy or missing perms).');
            return;
          }
          await tgtMember.timeout(DEFAULT_MUTE_MS, `${interaction.user.tag}: ${reasonForAction}`);
          const { action: modAction } = await api.createModAction(interaction.guildId, {
            type: 'TIMEOUT',
            userId: report.targetUserId,
            moderatorId: interaction.user.id,
            reason: reasonForAction,
            durationMs: DEFAULT_MUTE_MS,
            expiresAt: new Date(Date.now() + DEFAULT_MUTE_MS).toISOString(),
          });
          await api.reviewReport(interaction.guildId, report.id, {
            action,
            reviewerId: interaction.user.id,
            ...(note ? { note } : {}),
          });
          await interaction.editReply({
            embeds: [buildModActionEmbed(modAction, tgtMember.user, interaction.user)],
          });
          return;
        }

        if (action === 'delete') {
          let deleted = false;
          if (report.targetMessageId) {
            const channel = interaction.guild.channels.cache.get(report.channelId);
            if (channel && channel.type === ChannelType.GuildText) {
              const message = await (channel as TextChannel).messages
                .fetch(report.targetMessageId)
                .catch(() => null);
              if (message) {
                await message.delete().catch(() => {});
                deleted = true;
              }
            }
          }
          await api.reviewReport(interaction.guildId, report.id, {
            action,
            reviewerId: interaction.user.id,
            ...(note ? { note } : {}),
          });
          await interaction.editReply(
            deleted
              ? '🗑️ Source message deleted; report closed.'
              : 'Source message was already gone; report closed.',
          );
          return;
        }

        // dismiss
        await api.reviewReport(interaction.guildId, report.id, {
          action,
          reviewerId: interaction.user.id,
          ...(note ? { note } : {}),
        });
        await interaction.editReply('Report dismissed.');
      } catch (err) {
        log.warn('Report review failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        const msg = err instanceof ApiError ? err.message : 'Failed to review report.';
        await interaction.editReply(msg);
      }
    }
  },
};
