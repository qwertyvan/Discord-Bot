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

export const warnings: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription("List a member's active warnings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Member to inspect.').setRequired(true)),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const target = interaction.options.getUser('user', true);

    try {
      const { actions } = await api.listModActions(interaction.guildId, {
        userId: target.id,
        type: 'WARN',
        limit: 25,
      });
      const active = actions.filter((a) => a.active);

      if (active.length === 0) {
        await interaction.reply({
          content: `${target} has no active warnings.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Warnings for ${target.tag}`)
        .setThumbnail(target.displayAvatarURL())
        .setColor(0xfaa61a)
        .setFooter({ text: `${active.length} active warning${active.length === 1 ? '' : 's'}` });

      for (const w of active.slice(0, 10)) {
        embed.addFields({
          name: `#${w.caseNumber} · ${time(new Date(w.createdAt), TimestampStyles.ShortDateTime)} · by <@${w.moderatorId}>`,
          value: w.reason + (w.category ? `\n*Category:* ${w.category}` : ''),
        });
      }

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (err) {
      const msg =
        err instanceof ApiError ? `Failed to fetch warnings: ${err.message}` : 'Failed to fetch warnings.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
