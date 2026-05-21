import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const level: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Admin XP controls.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('give')
        .setDescription('Give (or take) XP from a member.')
        .addUserOption((o) => o.setName('user').setDescription('Target.').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('amount').setDescription('XP delta (negative to subtract).').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription("Reset a member's XP to zero.")
        .addUserOption((o) => o.setName('user').setDescription('Target.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user', true);
    try {
      if (sub === 'give') {
        const amount = interaction.options.getInteger('amount', true);
        const updated = await api.giveXp(interaction.guildId, target.id, amount);
        await interaction.reply({
          content: `${target} now has **${updated.xp.toLocaleString()}** XP (level ${updated.level}).`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'reset') {
        await api.resetXp(interaction.guildId, target.id);
        await interaction.reply({
          content: `🗑️ Reset XP for ${target}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
