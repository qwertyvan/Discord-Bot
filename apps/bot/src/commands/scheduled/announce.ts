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

export const announce: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Schedule a one-shot or recurring announcement.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('schedule')
        .setDescription('Schedule an announcement.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to post in.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('content').setDescription('Message content.').setRequired(true).setMaxLength(2000),
        )
        .addStringOption((o) =>
          o.setName('in').setDescription('When (e.g. 30m, 2h, 7d).').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('repeat_every')
            .setDescription('Optional repeat interval (e.g. 1d, 1w).'),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List scheduled announcements.'))
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel a scheduled announcement.')
        .addStringOption((o) => o.setName('id').setDescription('Announcement ID.').setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'schedule') {
        const channel = interaction.options.getChannel('channel', true);
        const content = interaction.options.getString('content', true);
        const rawIn = interaction.options.getString('in', true);
        const rawRepeat = interaction.options.getString('repeat_every');

        const delayMs = parseDuration(rawIn);
        if (delayMs === null || delayMs < 60_000) {
          await interaction.reply({
            content: 'Use a duration like `30m`, `2h`, `7d`. Minimum 60s.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        let repeatSeconds: number | undefined;
        if (rawRepeat) {
          const ms = parseDuration(rawRepeat);
          if (ms === null || ms < 60_000) {
            await interaction.reply({
              content: 'Invalid repeat interval. Use durations like `1d`, `1w`. Minimum 60s.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          repeatSeconds = Math.floor(ms / 1000);
        }

        const runAt = new Date(Date.now() + delayMs).toISOString();
        const a = await api.createAnnouncement(interaction.guildId, {
          channelId: channel.id,
          content,
          runAt,
          ...(repeatSeconds !== undefined ? { repeatEvery: repeatSeconds } : {}),
          createdBy: interaction.user.id,
        });
        await interaction.reply({
          content: `📣 Scheduled announcement \`${a.id}\` in ${channel} ${time(
            new Date(a.runAt),
            TimestampStyles.RelativeTime,
          )}${repeatSeconds ? ` (repeats every ${rawRepeat})` : ''}.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (sub === 'list') {
        const { announcements } = await api.listAnnouncements(interaction.guildId);
        if (announcements.length === 0) {
          await interaction.reply({
            content: 'No scheduled announcements.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('Scheduled announcements')
          .setColor(0x5865f2)
          .setFooter({ text: `${announcements.length} scheduled` });
        for (const a of announcements.slice(0, 15)) {
          embed.addFields({
            name: `${time(new Date(a.runAt), TimestampStyles.RelativeTime)}${
              a.repeatEvery ? ` · repeats ${a.repeatEvery}s` : ''
            } · <#${a.channelId}>`,
            value: `${(a.content ?? '*embed only*').slice(0, 200)}\n\`${a.id}\``,
          });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else if (sub === 'cancel') {
        const id = interaction.options.getString('id', true);
        await api.deleteAnnouncement(interaction.guildId, id);
        await interaction.reply({ content: `🗑️ Cancelled \`${id}\`.`, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed.';
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  },
};
