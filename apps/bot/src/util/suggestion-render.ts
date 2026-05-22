import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  time,
  TimestampStyles,
} from 'discord.js';
import type { Suggestion } from '@discord-bot/shared';

const STATUS_COLOR: Record<Suggestion['status'], number> = {
  open: 0x5865f2,
  accepted: 0x57f287,
  rejected: 0xed4245,
  implemented: 0xfee75c,
};

const STATUS_LABEL: Record<Suggestion['status'], string> = {
  open: '💡 Open',
  accepted: '✅ Accepted',
  rejected: '❌ Rejected',
  implemented: '🚀 Implemented',
};

export function buildSuggestionEmbed(s: Suggestion): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(STATUS_LABEL[s.status])
    .setColor(STATUS_COLOR[s.status])
    .setDescription(s.content)
    .addFields(
      { name: '👍 Up', value: String(s.votes.up), inline: true },
      { name: '👎 Down', value: String(s.votes.down), inline: true },
    )
    .setFooter({ text: `Suggestion ${s.id}` })
    .setTimestamp(new Date(s.createdAt));
  if (s.reviewedBy && s.status !== 'open') {
    embed.addFields({
      name: 'Reviewed',
      value: `by <@${s.reviewedBy}> ${
        s.reviewedAt ? time(new Date(s.reviewedAt), TimestampStyles.RelativeTime) : ''
      }${s.reviewNote ? `\n${s.reviewNote}` : ''}`,
    });
  }
  return embed;
}

export function buildSuggestionComponents(s: Suggestion): ActionRowBuilder<ButtonBuilder>[] {
  if (s.status !== 'open') return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`sgst:up:${s.id}`)
        .setLabel(`👍 ${s.votes.up}`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`sgst:down:${s.id}`)
        .setLabel(`👎 ${s.votes.down}`)
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function suggestionMessagePayload(s: Suggestion) {
  return {
    embeds: [buildSuggestionEmbed(s)],
    components: buildSuggestionComponents(s),
  };
}
