import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function formatNow(tz: string): { time: string; date: string; offset: string } {
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(now);
  // Offset from UTC for the timezone.
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value;
  return { time, date, offset: formatted ?? '' };
}

export const time: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('time')
    .setDescription('Show the current time for a user or set your own timezone.')
    .addSubcommand((s) =>
      s
        .setName('show')
        .setDescription('Show a user\'s current local time.')
        .addUserOption((o) => o.setName('user').setDescription('Defaults to you.')),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set your timezone (IANA name, e.g. Europe/Berlin).')
        .addStringOption((o) =>
          o.setName('tz').setDescription('IANA timezone identifier.').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('clear').setDescription('Forget your timezone.')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'set') {
        const tz = interaction.options.getString('tz', true);
        if (!validTimezone(tz)) {
          await interaction.reply({
            content: `\`${tz}\` is not a recognized IANA timezone (try \`Europe/Berlin\`, \`America/New_York\`, etc.).`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await api.setUserTimezone(interaction.user.id, tz);
        await interaction.reply({
          content: `✅ Saved your timezone as \`${tz}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'clear') {
        await api.clearUserTimezone(interaction.user.id);
        await interaction.reply({ content: '🗑️ Forgot your timezone.', flags: MessageFlags.Ephemeral });
      } else {
        const target = interaction.options.getUser('user') ?? interaction.user;
        const stored = await api.getUserTimezone(target.id);
        if (!stored.tz) {
          await interaction.reply({
            content:
              target.id === interaction.user.id
                ? "You haven't set a timezone yet. Try `/time set tz:Europe/Berlin`."
                : `${target} hasn't set a timezone.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const { time: t, date, offset } = formatNow(stored.tz);
        const embed = new EmbedBuilder()
          .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
          .setColor(0x5865f2)
          .addFields(
            { name: 'Local time', value: `**${t}**` },
            { name: 'Date', value: date, inline: true },
            { name: 'Timezone', value: `${stored.tz} (${offset})`, inline: true },
          );
        await interaction.reply({ embeds: [embed] });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
