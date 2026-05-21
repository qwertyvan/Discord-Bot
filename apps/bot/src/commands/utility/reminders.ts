import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

export const reminders: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('reminders')
    .setDescription('Manage your reminders.')
    .addSubcommand((s) => s.setName('list').setDescription('List your upcoming reminders.'))
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel a reminder by ID.')
        .addStringOption((o) => o.setName('id').setDescription('Reminder ID.').setRequired(true)),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'list') {
        const { reminders: list } = await api.listReminders(interaction.user.id);
        if (list.length === 0) {
          await interaction.reply({ content: 'You have no upcoming reminders.', flags: MessageFlags.Ephemeral });
          return;
        }
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('Your reminders')
          .setFooter({ text: `${list.length} reminder${list.length === 1 ? '' : 's'}` });
        for (const r of list.slice(0, 15)) {
          embed.addFields({
            name: `${time(new Date(r.runAt), TimestampStyles.RelativeTime)} · \`${r.id}\``,
            value: r.content,
          });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else if (sub === 'cancel') {
        const id = interaction.options.getString('id', true);
        await api.deleteReminder(id);
        await interaction.reply({ content: `🗑️ Cancelled \`${id}\`.`, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
