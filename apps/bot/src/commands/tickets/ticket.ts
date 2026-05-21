import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AttachmentBuilder as AttachmentBuilderType,
  type TextChannel,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const ticket: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage the current ticket.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('close')
        .setDescription('Close this ticket (works inside a ticket thread).')
        .addStringOption((o) => o.setName('reason').setDescription('Why closing?').setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('assign')
        .setDescription('Assign this ticket to a staff member.')
        .addUserOption((o) => o.setName('staff').setDescription('Staff member.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.channel) return;
    const sub = interaction.options.getSubcommand();

    let existing;
    try {
      existing = await api.getTicketByChannel(interaction.guildId, interaction.channel.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        await interaction.reply({
          content: 'This channel is not a ticket thread.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      throw err;
    }

    if (sub === 'close') {
      // Permissions: ticket owner or staff (Manage Messages) may close.
      const isOwner = interaction.user.id === existing.userId;
      const isStaff =
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
      if (!isOwner && !isStaff) {
        await interaction.reply({
          content: 'Only the ticket opener or staff can close this ticket.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const reason = interaction.options.getString('reason') ?? null;
      await interaction.deferReply();

      // If transcripts are enabled, render before the channel is archived.
      const cfg = await api.getTicketConfig(interaction.guildId).catch(() => null);
      let transcriptAttachment: { content: string; files: AttachmentBuilderType[] } | null = null;
      if (cfg?.transcriptsEnabled && interaction.channel.isTextBased()) {
        try {
          const { renderTranscript } = await import('../../integrations/ticket-transcript.js');
          const { AttachmentBuilder } = await import('discord.js');
          const html = await renderTranscript(interaction.channel, {
            title: `Ticket #${existing.number}`,
            openedAt: existing.openedAt,
            closedAt: new Date().toISOString(),
            closedBy: interaction.user.tag,
          });
          transcriptAttachment = {
            content: `📝 Transcript for ticket #${existing.number}`,
            files: [
              new AttachmentBuilder(Buffer.from(html, 'utf8'), {
                name: `ticket-${existing.number}.html`,
              }),
            ],
          };
        } catch (err) {
          // Transcript failures don't block the close.
          void err;
        }
      }

      await api.updateTicket(interaction.guildId, existing.id, {
        status: 'closed',
        closedBy: interaction.user.id,
        closeReason: reason,
      });

      // Post transcript before archiving (so attachments target the right channel).
      if (transcriptAttachment) {
        const target = cfg?.transcriptChannelId
          ? interaction.guild?.channels.cache.get(cfg.transcriptChannelId)
          : interaction.channel;
        if (target && target.isTextBased()) {
          await (target as TextChannel).send(transcriptAttachment).catch(() => {});
        }
      }

      // Archive thread if applicable.
      if (interaction.channel.isThread()) {
        await interaction.channel.setArchived(true, `Ticket closed by ${interaction.user.tag}`).catch(() => {});
      } else if (interaction.channel.type === ChannelType.GuildText) {
        await interaction.channel.permissionOverwrites
          .edit(existing.userId, { ViewChannel: false }, { reason: 'Ticket closed' })
          .catch(() => {});
      }
      await interaction.editReply(`🔒 Ticket #${existing.number} closed${reason ? ` — ${reason}` : ''}.`);
      return;
    }

    if (sub === 'assign') {
      const staff = interaction.options.getUser('staff', true);
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
        await interaction.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral });
        return;
      }
      await api.updateTicket(interaction.guildId, existing.id, { assignedTo: staff.id });
      await interaction.reply(`👤 Ticket #${existing.number} assigned to ${staff}.`);
    }
  },
};
