import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { ApiError } from '../../api-client.js';
import { computePruneCandidates } from '../../scheduler.js';
import { log } from '../../logger.js';

const PREVIEW_LIMIT = 25;

export const prune: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('prune')
    .setDescription('Inactivity prune: identify or remove inactive members.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s.setName('preview').setDescription('Dry-run: list members who would be pruned.'),
    )
    .addSubcommand((s) =>
      s
        .setName('run')
        .setDescription('Kick inactive members per the configured policy.')
        .addBooleanOption((o) =>
          o
            .setName('notify_dm')
            .setDescription('Override the policy notify-DM flag for this run.'),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let plan;
    try {
      plan = await computePruneCandidates(interaction.guild);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to compute prune candidates.';
      await interaction.editReply({ content: msg });
      return;
    }

    if (sub === 'preview') {
      if (plan.candidates.length === 0) {
        await interaction.editReply({
          content:
            `No prune candidates. Policy threshold: ${plan.inactiveDays} days of inactivity.`,
        });
        return;
      }
      const head = plan.candidates.slice(0, PREVIEW_LIMIT);
      const overflow = plan.candidates.length - head.length;
      const embed = new EmbedBuilder()
        .setTitle('Prune preview (dry run)')
        .setColor(0xfaa61a)
        .setDescription(
          [
            `**${plan.candidates.length}** members inactive for ≥${plan.inactiveDays} days.`,
            overflow > 0 ? `Showing the first ${head.length}.` : null,
            '',
            head.map((c) => `• <@${c.member.id}> (${c.member.user.tag})`).join('\n'),
          ]
            .filter(Boolean)
            .join('\n'),
        );
      await interaction.editReply({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
      return;
    }

    // run
    if (!plan.enabled) {
      await interaction.editReply({
        content:
          'Prune policy is disabled. Enable it via the dashboard (or configure it) before running.',
      });
      return;
    }
    if (plan.candidates.length === 0) {
      await interaction.editReply({
        content: `No members met the prune threshold (${plan.inactiveDays} days).`,
      });
      return;
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.KickMembers)) {
      await interaction.editReply({
        content: 'I need the **Kick Members** permission to prune.',
      });
      return;
    }

    const overrideNotify = interaction.options.getBoolean('notify_dm');
    const notifyDm = overrideNotify ?? plan.notifyDm;
    const reason = `Inactivity prune (≥${plan.inactiveDays} days) by ${interaction.user.tag}`;

    let kicked = 0;
    let failed = 0;
    let dmDelivered = 0;
    for (const { member } of plan.candidates) {
      // Re-verify safety per-candidate in case the cache shifted.
      if (member.id === interaction.guild.ownerId) continue;
      if (member.permissions.has(PermissionFlagsBits.ManageGuild)) continue;
      if (!member.kickable) {
        failed++;
        continue;
      }
      if (notifyDm) {
        try {
          await member.send({
            content:
              `You have been removed from **${interaction.guild.name}** ` +
              `for inactivity (no recent activity in ${plan.inactiveDays} days). ` +
              `You are welcome to rejoin any time.`,
          });
          dmDelivered++;
        } catch {
          // DM closed — kick anyway.
        }
      }
      try {
        await member.kick(reason);
        kicked++;
      } catch (err) {
        failed++;
        log.warn('Prune kick failed', {
          guildId: interaction.guildId,
          userId: member.id,
          err: String(err),
        });
      }
    }

    await interaction.editReply({
      content:
        `🧹 Prune complete: **${kicked}** kicked` +
        (failed > 0 ? `, ${failed} failed` : '') +
        (notifyDm ? `, ${dmDelivered} DMs delivered` : '') +
        '.',
    });
  },
};
