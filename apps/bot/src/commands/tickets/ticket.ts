import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
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
      await api.updateTicket(interaction.guildId, existing.id, {
        status: 'closed',
        closedBy: interaction.user.id,
        closeReason: reason,
      });

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
