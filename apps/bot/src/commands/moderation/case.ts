import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { buildModActionEmbed } from '../../util/mod-action-embed.js';

export const caseCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Look up a moderation action by its case number.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addIntegerOption((o) =>
      o.setName('number').setDescription('Case number.').setRequired(true).setMinValue(1),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const number = interaction.options.getInteger('number', true);
    try {
      const action = await api.getCase(interaction.guildId, number);
      const [target, moderator] = await Promise.all([
        interaction.client.users.fetch(action.userId).catch(() => null),
        interaction.client.users.fetch(action.moderatorId).catch(() => null),
      ]);
      if (!target || !moderator) {
        await interaction.reply({
          content: `Case #${number} exists but its users could not be resolved.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({ embeds: [buildModActionEmbed(action, target, moderator)], flags: MessageFlags.Ephemeral });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to look up case.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
