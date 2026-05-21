import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { buildModActionEmbed } from '../../util/mod-action-embed.js';
import { log } from '../../logger.js';

const SNOWFLAKE = /^\d{17,20}$/;

export const unban: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(0)
    .addStringOption((o) => o.setName('user_id').setDescription('Discord user ID to unban.').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for unban.').setMaxLength(500)),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return;
    const userId = interaction.options.getString('user_id', true).trim();
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!SNOWFLAKE.test(userId)) {
      await interaction.reply({ content: "That doesn't look like a valid user ID.", flags: MessageFlags.Ephemeral });
      return;
    }

    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      await interaction.reply({ content: 'That user is not banned.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.guild.bans.remove(userId, `${interaction.user.tag}: ${reason}`);

    try {
      const { action } = await api.createModAction(interaction.guildId!, {
        type: 'UNBAN',
        userId,
        moderatorId: interaction.user.id,
        reason,
      });
      await interaction.reply({ embeds: [buildModActionEmbed(action, ban.user, interaction.user)] });
    } catch (err) {
      log.warn('Failed to log unban', { err: err instanceof Error ? err.message : String(err) });
      const msg = err instanceof ApiError ? `Unbanned, but failed to log: ${err.message}` : `Unbanned <@${userId}>.`;
      await interaction.reply({ content: msg });
    }
  },
};
