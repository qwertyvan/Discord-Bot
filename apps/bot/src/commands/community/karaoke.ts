import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TimestampStyles,
  time,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import type { SlashCommand } from '../../command.js';
import { api, ApiError } from '../../api-client.js';
import { parseDuration } from '../../util/duration.js';
import { karaokeMessagePayload } from '../../util/karaoke-render.js';
import type { KaraokeNightStatus } from '@discord-bot/shared';

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

function rsvpCountsOf(
  counts: { yes: number; maybe: number; no: number } | undefined,
): { yes: number; maybe: number; no: number } {
  return counts ?? { yes: 0, maybe: 0, no: 0 };
}

export const karaoke: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('karaoke')
    .setDescription('Schedule and run karaoke nights.')
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName('schedule')
        .setDescription('Schedule a karaoke night.')
        .addChannelOption((o) =>
          o
            .setName('voice-channel')
            .setDescription('Voice channel for the karaoke.')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('title').setDescription('Karaoke title.').setRequired(true).setMaxLength(120),
        )
        .addStringOption((o) =>
          o
            .setName('when')
            .setDescription('ISO timestamp or "in 2h", "in 1d".')
            .setRequired(true),
        )
        .addChannelOption((o) =>
          o
            .setName('announce-channel')
            .setDescription('Text channel for the announcement embed (defaults to this channel).')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((o) =>
          o
            .setName('recap-channel')
            .setDescription('Text channel where the recap is posted when the night ends.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('List karaoke nights.')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Filter by status.')
            .addChoices(
              { name: 'scheduled', value: 'scheduled' },
              { name: 'live', value: 'live' },
              { name: 'ended', value: 'ended' },
              { name: 'cancelled', value: 'cancelled' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Submit a song to a karaoke night.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Karaoke night id.').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('title').setDescription('Song title.').setRequired(true).setMaxLength(200),
        )
        .addStringOption((o) =>
          o.setName('url').setDescription('Link to the song / video.').setMaxLength(2048),
        )
        .addStringOption((o) =>
          o.setName('notes').setDescription('Notes for the host.').setMaxLength(500),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('played')
        .setDescription('Mark a song as played (host only).')
        .addStringOption((o) =>
          o.setName('id').setDescription('Karaoke night id.').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('song-id').setDescription('Song id.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Cancel a karaoke night.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Karaoke night id.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('now')
        .setDescription('Start the karaoke night now (host only).')
        .addStringOption((o) =>
          o.setName('id').setDescription('Karaoke night id.').setRequired(true),
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'schedule') {
        await handleSchedule(interaction);
      } else if (sub === 'list') {
        await handleList(interaction);
      } else if (sub === 'add') {
        await handleAdd(interaction);
      } else if (sub === 'played') {
        await handlePlayed(interaction);
      } else if (sub === 'cancel') {
        await handleCancel(interaction);
      } else if (sub === 'now') {
        await handleNow(interaction);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Karaoke command failed.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    }
  },
};

async function handleSchedule(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild || !interaction.guildId) return;
  const voice = interaction.options.getChannel('voice-channel', true);
  const title = interaction.options.getString('title', true);
  const whenRaw = interaction.options.getString('when', true);
  const announce = interaction.options.getChannel('announce-channel') ?? interaction.channel;
  const recap = interaction.options.getChannel('recap-channel') ?? null;

  if (
    voice.type !== ChannelType.GuildVoice &&
    voice.type !== ChannelType.GuildStageVoice
  ) {
    await interaction.reply({
      content: 'Pick a voice or stage channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const announceChannel = announce as TextChannel | null;
  if (
    !announceChannel ||
    (announceChannel.type !== ChannelType.GuildText &&
      announceChannel.type !== ChannelType.GuildAnnouncement)
  ) {
    await interaction.reply({
      content: 'Announce channel must be a text channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const scheduledFor = parseWhen(whenRaw);
  if (!scheduledFor || scheduledFor.getTime() <= Date.now()) {
    await interaction.reply({
      content: 'Start time must be a future date (ISO) or `in <duration>` (e.g. `in 2h`).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const created = await api.createKaraokeNight(interaction.guildId, {
    voiceChannelId: voice.id,
    hostId: interaction.user.id,
    title,
    scheduledFor: scheduledFor.toISOString(),
    announceChannelId: announceChannel.id,
    ...(recap ? { recapChannelId: recap.id } : {}),
  });

  const payload = karaokeMessagePayload(created, [], { yes: 0, maybe: 0, no: 0 });
  await announceChannel.send(payload).catch(() => undefined);

  await interaction.editReply(
    `🎤 Karaoke **${title}** scheduled for ${time(scheduledFor, TimestampStyles.LongDateTime)} (\`${created.id}\`).`,
  );
}

async function handleList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  const statusOpt = interaction.options.getString('status') as KaraokeNightStatus | null;
  const { nights } = await api.listKaraokeNights(interaction.guildId, {
    ...(statusOpt ? { status: statusOpt } : {}),
    limit: 25,
  });
  if (nights.length === 0) {
    await interaction.reply({
      content: 'No karaoke nights to show.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle(statusOpt ? `Karaoke nights · ${statusOpt}` : 'Karaoke nights')
    .setColor(0x5865f2)
    .setDescription(
      nights
        .map((n) => {
          const when = time(new Date(n.scheduledFor), TimestampStyles.RelativeTime);
          return `**${n.title}** — ${when} · host <@${n.hostId}> · <#${n.voiceChannelId}> · \`${n.id}\` · _${n.status}_`;
        })
        .join('\n'),
    );
  await interaction.reply({
    embeds: [embed],
    allowedMentions: { parse: [] },
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  const id = interaction.options.getString('id', true);
  const title = interaction.options.getString('title', true);
  const url = interaction.options.getString('url') ?? undefined;
  const notes = interaction.options.getString('notes') ?? undefined;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const song = await api.addKaraokeSong(interaction.guildId, id, {
    submitterId: interaction.user.id,
    title,
    ...(url ? { url } : {}),
    ...(notes ? { notes } : {}),
  });
  await refreshAnnouncement(interaction, id).catch(() => undefined);
  await interaction.editReply(`🎵 Added **${title}** to the queue (\`${song.id}\`).`);
}

async function handlePlayed(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  const id = interaction.options.getString('id', true);
  const songId = interaction.options.getString('song-id', true);
  const night = await api.getKaraokeNight(interaction.guildId, id);
  if (night.hostId !== interaction.user.id && !memberCanManage(interaction)) {
    await interaction.reply({
      content: 'Only the host can mark songs as played.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await api.updateKaraokeSong(interaction.guildId, id, songId, { played: true });
  await refreshAnnouncement(interaction, id).catch(() => undefined);
  await interaction.reply({
    content: '✅ Marked as played.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCancel(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild) return;
  const id = interaction.options.getString('id', true);
  const night = await api.getKaraokeNight(interaction.guildId, id).catch(() => null);
  if (!night) {
    await interaction.reply({
      content: 'Karaoke night not found.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (night.hostId !== interaction.user.id && !memberCanManage(interaction)) {
    await interaction.reply({
      content: 'Only the host or someone with Manage Events can cancel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await api.updateKaraokeNight(interaction.guildId, id, { status: 'cancelled' });
  await refreshAnnouncement(interaction, id).catch(() => undefined);
  await interaction.reply({
    content: `🚫 Cancelled karaoke **${night.title}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleNow(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  const id = interaction.options.getString('id', true);
  const night = await api.getKaraokeNight(interaction.guildId, id);
  if (night.hostId !== interaction.user.id && !memberCanManage(interaction)) {
    await interaction.reply({
      content: 'Only the host can start the night.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (night.status !== 'scheduled') {
    await interaction.reply({
      content: `Cannot start — current status is **${night.status}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await api.updateKaraokeNight(interaction.guildId, id, { status: 'live' });
  await refreshAnnouncement(interaction, id).catch(() => undefined);
  await interaction.reply({
    content: `🎤 Karaoke **${night.title}** is now live!`,
    flags: MessageFlags.Ephemeral,
  });
}

function memberCanManage(
  interaction: ChatInputCommandInteraction,
): boolean {
  if (!interaction.memberPermissions) return false;
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageEvents);
}

// Best-effort: re-render the announcement message after a mutating action.
// We don't track the announcement message id (host can post it anywhere), so
// we just refresh the API copy here — the scheduler / button handlers do the
// authoritative edits on a known message via the embed builder.
async function refreshAnnouncement(
  interaction: ChatInputCommandInteraction,
  nightId: string,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild) return;
  const night = await api.getKaraokeNight(interaction.guildId, nightId);
  const announceId = night.announceChannelId;
  if (!announceId) return;
  const channel = interaction.guild.channels.cache.get(announceId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  // Try to find a recent embed footer matching this night and refresh it.
  const msgs = await (channel as TextChannel).messages.fetch({ limit: 25 }).catch(() => null);
  if (!msgs) return;
  const target = msgs.find(
    (m) =>
      m.author.id === interaction.client.user?.id &&
      m.embeds.some((e) => e.footer?.text === `Karaoke id ${night.id}`),
  );
  if (!target) return;
  const payload = karaokeMessagePayload(
    night,
    night.songs ?? [],
    rsvpCountsOf(night.rsvpCounts),
  );
  await target.edit(payload).catch(() => undefined);
}
