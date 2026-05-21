import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { parseDuration } from '../../util/duration.js';
import { eventMessagePayload } from '../../util/event-render.js';

function parseStart(input: string): Date | null {
  // Accept ISO timestamp or a "in <duration>" form.
  const trimmed = input.trim();
  if (/^in\s+/i.test(trimmed)) {
    const ms = parseDuration(trimmed.replace(/^in\s+/i, ''));
    if (ms === null) return null;
    return new Date(Date.now() + ms);
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

export const event: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create or manage events with RSVPs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create an event with RSVP buttons.')
        .addStringOption((o) =>
          o.setName('title').setDescription('Event title.').setRequired(true).setMaxLength(200),
        )
        .addStringOption((o) =>
          o.setName('start').setDescription('ISO timestamp or "in 2h", "in 1d".').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Event description.').setMaxLength(2000),
        )
        .addStringOption((o) =>
          o.setName('location').setDescription('Where the event happens.').setMaxLength(200),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to post in (defaults to this channel).')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Delete an event.')
        .addStringOption((o) => o.setName('id').setDescription('Event ID.').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('upcoming').setDescription('List upcoming events.'),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'create') {
        const title = interaction.options.getString('title', true);
        const startRaw = interaction.options.getString('start', true);
        const description = interaction.options.getString('description') ?? undefined;
        const location = interaction.options.getString('location') ?? undefined;
        const channel = (interaction.options.getChannel('channel') ?? interaction.channel) as
          | TextChannel
          | null;
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({
            content: 'Pick a text channel.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const startsAt = parseStart(startRaw);
        if (!startsAt || startsAt.getTime() < Date.now()) {
          await interaction.reply({
            content: 'Start time must be a future date (ISO) or `in <duration>`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const created = await api.createEvent(interaction.guildId, {
          channelId: channel.id,
          title,
          ...(description ? { description } : {}),
          startsAt: startsAt.toISOString(),
          ...(location ? { location } : {}),
          createdBy: interaction.user.id,
        });
        const payload = eventMessagePayload(created);
        const message = await channel.send(payload);
        await api.updateEvent(interaction.guildId, created.id, { messageId: message.id });
        await interaction.editReply(`📅 Event created (\`${created.id}\`).`);
      } else if (sub === 'cancel') {
        const id = interaction.options.getString('id', true);
        const ev = await api.getEvent(interaction.guildId, id).catch(() => null);
        if (ev?.channelId && ev?.messageId) {
          const channel = interaction.guild.channels.cache.get(ev.channelId);
          if (channel && channel.type === ChannelType.GuildText) {
            const msg = await (channel as TextChannel).messages
              .fetch(ev.messageId)
              .catch(() => null);
            if (msg) await msg.delete().catch(() => {});
          }
        }
        await api.deleteEvent(interaction.guildId, id);
        await interaction.reply({ content: `🗑️ Cancelled \`${id}\`.`, flags: MessageFlags.Ephemeral });
      } else if (sub === 'upcoming') {
        const { events } = await api.listEvents(interaction.guildId, { upcoming: true, limit: 15 });
        if (events.length === 0) {
          await interaction.reply({ content: 'No upcoming events.', flags: MessageFlags.Ephemeral });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Upcoming events')
          .setColor(0x5865f2)
          .setDescription(
            events
              .map(
                (e) =>
                  `**${e.title}** — ${time(new Date(e.startsAt), TimestampStyles.RelativeTime)} in <#${e.channelId}>${
                    e.location ? ` · ${e.location}` : ''
                  }\n   ✅ ${e.counts.yes} · 🤔 ${e.counts.maybe} · ❌ ${e.counts.no} · \`${e.id}\``,
              )
              .join('\n\n'),
          );
        await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
