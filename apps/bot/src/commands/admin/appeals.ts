import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { AppealStatus } from '@discord-bot/shared';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const appeals: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('appeals')
    .setDescription('Review user appeals and configure the appeal SLA.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('List appeals.')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Filter by status (default: open).')
            .addChoices(
              { name: 'open', value: 'open' },
              { name: 'approved', value: 'approved' },
              { name: 'denied', value: 'denied' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('review')
        .setDescription('Approve or deny an appeal.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Appeal ID.').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('decision')
            .setDescription('Approve or deny.')
            .setRequired(true)
            .addChoices(
              { name: 'approve', value: 'approved' },
              { name: 'deny', value: 'denied' },
            ),
        )
        .addStringOption((o) =>
          o.setName('note').setDescription('Optional note DMed to the user.').setMaxLength(500),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('sla')
        .setDescription('Configure the stale-appeal reminder SLA.')
        .addIntegerOption((o) =>
          o
            .setName('warn_hours')
            .setDescription('Hours after which an open appeal counts as stale.')
            .setMinValue(1)
            .setMaxValue(720),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel for stale-appeal reminders. Pass none to disable.')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addBooleanOption((o) =>
          o.setName('disable').setDescription('Clear the reminder channel.'),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'list') {
        const status = (interaction.options.getString('status') as AppealStatus | null) ?? 'open';
        const { appeals: items } = await api.listAppeals(interaction.guildId, { status, limit: 20 });
        if (items.length === 0) {
          await interaction.reply({
            content: `No appeals with status **${status}**.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const lines = items.map((a) => {
          const created = `<t:${Math.floor(new Date(a.createdAt).getTime() / 1000)}:R>`;
          return `• \`${a.id}\` — <@${a.userId}> — ${created}\n  ${a.message.slice(0, 120)}`;
        });
        await interaction.reply({
          content: `**Appeals (${status})**\n${lines.join('\n')}`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'review') {
        const id = interaction.options.getString('id', true);
        const decision = interaction.options.getString('decision', true) as 'approved' | 'denied';
        const note = interaction.options.getString('note') ?? undefined;

        const updated = await api.reviewAppeal(interaction.guildId, id, {
          status: decision,
          reviewedBy: interaction.user.id,
          ...(note ? { reviewNote: note } : {}),
        });

        // DM the user with the outcome.
        const user = await interaction.client.users.fetch(updated.userId).catch(() => null);
        if (user) {
          const verdict = decision === 'approved' ? 'approved' : 'denied';
          const lines = [
            `Your appeal in **${interaction.guild.name}** was **${verdict}**.`,
            ...(note ? [`> ${note}`] : []),
          ];
          await user.send(lines.join('\n')).catch(() => {});
        }

        await interaction.reply({
          content: `Appeal \`${id}\` **${decision}**.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'sla') {
        const warnHours = interaction.options.getInteger('warn_hours') ?? undefined;
        const channel = interaction.options.getChannel('channel');
        const disable = interaction.options.getBoolean('disable') ?? false;

        const patch: { warnHours?: number; escalateChannelId?: string | null } = {};
        if (warnHours !== undefined) patch.warnHours = warnHours;
        if (disable) patch.escalateChannelId = null;
        else if (channel) patch.escalateChannelId = channel.id;

        if (Object.keys(patch).length === 0) {
          const current = await api.getAppealSla(interaction.guildId);
          const ch = current.escalateChannelId ? `<#${current.escalateChannelId}>` : '*(none)*';
          await interaction.reply({
            content: `Appeal SLA: **${current.warnHours}h** → ${ch}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const updated = await api.upsertAppealSla(interaction.guildId, patch);
        const ch = updated.escalateChannelId ? `<#${updated.escalateChannelId}>` : '*(none)*';
        await interaction.reply({
          content: `✅ Appeal SLA updated: **${updated.warnHours}h** → ${ch}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(async () => {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      });
    }
  },
};
