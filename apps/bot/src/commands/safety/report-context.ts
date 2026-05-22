import {
  ActionRowBuilder,
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { MessageContextCommand } from '../../command.js';

// Right-click → Apps → "Report message". Opens a modal asking for the
// reason; the modal submit handler in events/interactionCreate.ts is what
// actually files the report so it can carry the source message context
// through the modal's customId.
export const reportMessageContext: MessageContextCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('Report message')
    .setType(ApplicationCommandType.Message)
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: 'Reports only work inside a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const target = interaction.targetMessage;
    if (target.author.id === interaction.user.id) {
      await interaction.reply({
        content: 'You cannot report your own message.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`report-modal:${target.id}:${target.author.id}:${target.channelId}`)
      .setTitle('Report message');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Why are you reporting this message?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput),
    );

    await interaction.showModal(modal);
  },
};
