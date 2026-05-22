import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { parseDuration } from '../../util/duration.js';

function parseWhen(input: string): Date | null {
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

export const stage: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('stage')
    .setDescription('Schedule and manage Stage sessions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('schedule')
        .setDescription('Schedule a Stage session.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Stage channel.')
            .addChannelTypes(ChannelType.GuildStageVoice)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('topic')
            .setDescription('Stage topic.')
            .setRequired(true)
            .setMaxLength(120),
        )
        .addStringOption((o) =>
          o
            .setName('when')
            .setDescription('ISO timestamp or "in 2h", "in 1d".')
            .setRequired(true),
        )
        .addChannelOption((o) =>
          o
            .setName('recap_channel')
            .setDescription('Channel to post the recap embed in.')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List upcoming Stage sessions.'))
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel a scheduled Stage session.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Stage event ID.').setRequired(true),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'schedule') {
        const channel = interaction.options.getChannel('channel', true);
        const topic = interaction.options.getString('topic', true);
        const whenRaw = interaction.options.getString('when', true);
        const recap = interaction.options.getChannel('recap_channel');
        const when = parseWhen(whenRaw);
        if (!when || when.getTime() < Date.now()) {
          await interaction.reply({
            content: 'Start time must be a future ISO timestamp or `in <duration>`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const created = await api.createStageEvent(interaction.guildId, {
          channelId: channel.id,
          topic,
          scheduledFor: when.toISOString(),
          ...(recap ? { recapChannelId: recap.id } : {}),
        });
        await interaction.reply({
          content: `🎙️ Stage session \`${created.id}\` scheduled in <#${created.channelId}> ${time(
            new Date(created.scheduledFor),
            TimestampStyles.RelativeTime,
          )}.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { events } = await api.listStageEvents(interaction.guildId, { limit: 25 });
        const upcoming = events.filter(
          (e) => e.status === 'scheduled' || e.status === 'live',
        );
        if (upcoming.length === 0) {
          await interaction.reply({
            content: 'No upcoming Stage sessions.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Upcoming Stage sessions')
          .setColor(0x5865f2)
          .setFooter({ text: `${upcoming.length} session${upcoming.length === 1 ? '' : 's'}` });
        for (const e of upcoming.slice(0, 15)) {
          embed.addFields({
            name: `${e.status === 'live' ? '🔴 LIVE · ' : ''}${e.topic}`,
            value: `<#${e.channelId}> · ${time(new Date(e.scheduledFor), TimestampStyles.RelativeTime)}\n\`${e.id}\``,
          });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else if (sub === 'cancel') {
        const id = interaction.options.getString('id', true);
        await api.deleteStageEvent(interaction.guildId, id);
        await interaction.reply({
          content: `🗑️ Cancelled Stage session \`${id}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
