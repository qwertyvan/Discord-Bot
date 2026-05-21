import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const warnings: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription("List a member's warnings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName('user').setDescription('Member to inspect.').setRequired(true)),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const target = interaction.options.getUser('user', true);

    try {
      const { warnings: list } = await api.listWarnings(interaction.guildId, {
        userId: target.id,
        limit: 25,
      });

      if (list.length === 0) {
        await interaction.reply({
          content: `${target} has no warnings.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Warnings for ${target.tag}`)
        .setThumbnail(target.displayAvatarURL())
        .setColor(0xfaa61a)
        .setFooter({ text: `${list.length} warning${list.length === 1 ? '' : 's'}` });

      for (const w of list.slice(0, 10)) {
        embed.addFields({
          name: `${time(new Date(w.createdAt), TimestampStyles.ShortDateTime)} — by <@${w.moderatorId}>`,
          value: `${w.reason}\n\`${w.id}\``,
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
