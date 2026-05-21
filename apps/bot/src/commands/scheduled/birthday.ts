import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function isValidDate(month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  // Use a leap year so Feb 29 is allowed.
  const sample = new Date(Date.UTC(2024, month - 1, day));
  return sample.getUTCMonth() === month - 1 && sample.getUTCDate() === day;
}

export const birthday: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Manage your birthday.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set your birthday.')
        .addIntegerOption((o) =>
          o.setName('month').setDescription('Month 1–12.').setRequired(true).setMinValue(1).setMaxValue(12),
        )
        .addIntegerOption((o) =>
          o.setName('day').setDescription('Day 1–31.').setRequired(true).setMinValue(1).setMaxValue(31),
        )
        .addIntegerOption((o) =>
          o.setName('year').setDescription('Optional birth year.').setMinValue(1900).setMaxValue(2100),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription("Show a member's birthday.")
        .addUserOption((o) => o.setName('user').setDescription('Defaults to you.')),
    )
    .addSubcommand((s) => s.setName('clear').setDescription('Forget your birthday.')),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'set') {
        const month = interaction.options.getInteger('month', true);
        const day = interaction.options.getInteger('day', true);
        const year = interaction.options.getInteger('year') ?? undefined;
        if (!isValidDate(month, day)) {
          await interaction.reply({
            content: `${month}/${day} is not a real date.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await api.setBirthday(interaction.guildId, interaction.user.id, {
          month,
          day,
          ...(year ? { year } : {}),
        });
        await interaction.reply({
          content: `🎂 Saved your birthday as **${MONTH_NAMES[month - 1]} ${day}**${
            year ? ` ${year}` : ''
          }.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'show') {
        const target = interaction.options.getUser('user') ?? interaction.user;
        const bd = await api.getBirthday(interaction.guildId, target.id);
        if (!bd) {
          await interaction.reply({
            content:
              target.id === interaction.user.id
                ? "You haven't set a birthday yet. Try `/birthday set`."
                : `${target} hasn't set a birthday.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
          .setColor(0xeb459e)
          .setDescription(
            `🎂 **${MONTH_NAMES[bd.month - 1]} ${bd.day}**${bd.year ? ` ${bd.year}` : ''}`,
          );
        await interaction.reply({ embeds: [embed] });
      } else if (sub === 'clear') {
        await api.clearBirthday(interaction.guildId, interaction.user.id);
        await interaction.reply({ content: '🗑️ Forgot your birthday.', flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
