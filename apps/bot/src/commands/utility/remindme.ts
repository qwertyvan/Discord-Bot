import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { parseDuration } from '../../util/duration.js';

export const remindme: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Set a personal reminder.')
    .addStringOption((o) =>
      o.setName('when').setDescription('Duration, e.g. 10m, 2h, 1d.').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('what').setDescription('What to remind you about.').setRequired(true).setMaxLength(500),
    ),
  async execute(interaction) {
    const when = interaction.options.getString('when', true);
    const what = interaction.options.getString('what', true);

    const ms = parseDuration(when);
    if (ms === null || ms < 30_000) {
      await interaction.reply({
        content: 'Use a duration like `10m`, `2h`, `1d`. Minimum 30s.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (ms > 365 * 86_400_000) {
      await interaction.reply({ content: 'Maximum reminder is one year out.', flags: MessageFlags.Ephemeral });
      return;
    }
    const runAt = new Date(Date.now() + ms);

    try {
      await api.createReminder({
        userId: interaction.user.id,
        ...(interaction.inGuild() && interaction.guildId ? { guildId: interaction.guildId } : {}),
        ...(interaction.channelId ? { channelId: interaction.channelId } : {}),
        content: what,
        runAt: runAt.toISOString(),
      });
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⏰ Reminder set')
        .addFields(
          { name: 'When', value: time(runAt, TimestampStyles.RelativeTime) },
          { name: 'What', value: what },
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to set reminder.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
