import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TimestampStyles,
  time,
} from 'discord.js';
import type { KaraokeNight, KaraokeSong } from '@discord-bot/shared';

const STATUS_BADGE: Record<KaraokeNight['status'], string> = {
  scheduled: '📅 Scheduled',
  live: '🎤 LIVE',
  ended: '🏁 Ended',
  cancelled: '🚫 Cancelled',
};

const STATUS_COLOR: Record<KaraokeNight['status'], number> = {
  scheduled: 0x5865f2,
  live: 0xed4245,
  ended: 0x747f8d,
  cancelled: 0x747f8d,
};

export function buildKaraokeEmbed(
  night: KaraokeNight,
  songs: KaraokeSong[],
  rsvpCounts: { yes: number; maybe: number; no: number },
): EmbedBuilder {
  const startsAt = new Date(night.scheduledFor);
  const lines: string[] = [];
  lines.push(`**Host:** <@${night.hostId}>`);
  lines.push(`**Voice:** <#${night.voiceChannelId}>`);
  lines.push(
    `**When:** ${time(startsAt, TimestampStyles.LongDateTime)} (${time(
      startsAt,
      TimestampStyles.RelativeTime,
    )})`,
  );
  lines.push(`**RSVPs:** ✅ ${rsvpCounts.yes} · 🤔 ${rsvpCounts.maybe} · ❌ ${rsvpCounts.no}`);

  const upcoming = songs.filter((s) => !s.playedAt).slice(0, 10);
  const played = songs.filter((s) => s.playedAt);
  const queueBlock = upcoming.length
    ? upcoming
        .map((s, idx) => {
          const link = s.url ? ` ([link](${s.url}))` : '';
          return `**${idx + 1}.** ${s.title}${link} — <@${s.submitterId}>`;
        })
        .join('\n')
    : '_No songs yet — submit one with the button below._';

  const embed = new EmbedBuilder()
    .setTitle(`${STATUS_BADGE[night.status]} · ${night.title}`)
    .setColor(STATUS_COLOR[night.status])
    .setDescription(lines.join('\n'))
    .addFields({
      name: `Queue (${upcoming.length}${songs.length > upcoming.length ? `/${songs.length}` : ''})`,
      value: queueBlock,
    });

  if (played.length) {
    embed.addFields({
      name: `Played (${played.length})`,
      value: played
        .slice(-5)
        .map((s) => `~~${s.title}~~ — <@${s.submitterId}>`)
        .join('\n'),
    });
  }

  embed.setFooter({ text: `Karaoke id ${night.id}` });
  return embed;
}

export function buildKaraokeButtons(night: KaraokeNight): ActionRowBuilder<ButtonBuilder>[] {
  const disabled = night.status === 'ended' || night.status === 'cancelled';
  const rsvpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ka:rsvp:${night.id}:yes`)
      .setLabel('Going')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`ka:rsvp:${night.id}:maybe`)
      .setLabel('Maybe')
      .setEmoji('🤔')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`ka:rsvp:${night.id}:no`)
      .setLabel('Not going')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
  const submitRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ka:add:${night.id}`)
      .setLabel('Submit song')
      .setEmoji('🎵')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
  return [rsvpRow, submitRow];
}

export function karaokeMessagePayload(
  night: KaraokeNight,
  songs: KaraokeSong[],
  rsvpCounts: { yes: number; maybe: number; no: number },
) {
  return {
    embeds: [buildKaraokeEmbed(night, songs, rsvpCounts)],
    components: buildKaraokeButtons(night),
  };
}
