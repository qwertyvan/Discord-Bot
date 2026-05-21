import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { Poll } from '@discord-bot/shared';

const BAR_CELLS = 12;

function bar(fraction: number): string {
  const filled = Math.round(fraction * BAR_CELLS);
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
}

export function buildPollEmbed(poll: Poll): EmbedBuilder {
  const closed = poll.closedAt !== null;
  const embed = new EmbedBuilder()
    .setTitle(closed ? `📊 ${poll.question}  ·  Closed` : `📊 ${poll.question}`)
    .setColor(closed ? 0x57f287 : 0x5865f2)
    .setFooter({
      text: [
        poll.anonymous ? 'Anonymous' : 'Public votes',
        poll.multiSelect ? 'Multi-select' : 'Single choice',
        `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}`,
      ].join(' · '),
    });

  const total = poll.totalVotes || 1;
  for (const opt of poll.options) {
    const pct = opt.voteCount / total;
    embed.addFields({
      name: `${opt.label} — ${opt.voteCount}`,
      value: `\`${bar(pct)}\` ${(pct * 100).toFixed(0)}%`,
    });
  }
  if (poll.closesAt && !closed) {
    embed.setDescription(`Closes <t:${Math.floor(new Date(poll.closesAt).getTime() / 1000)}:R>.`);
  }
  return embed;
}

/**
 * One button per option, split across up to two action rows (Discord caps at
 * five buttons per row). If a poll is closed, returns no components.
 */
export function buildPollComponents(poll: Poll): ActionRowBuilder<ButtonBuilder>[] {
  if (poll.closedAt) return [];
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let current = new ActionRowBuilder<ButtonBuilder>();
  for (const opt of poll.options) {
    if (current.components.length === 5) {
      rows.push(current);
      current = new ActionRowBuilder<ButtonBuilder>();
    }
    current.addComponents(
      new ButtonBuilder()
        .setCustomId(`poll:vote:${poll.id}:${opt.id}`)
        .setLabel(opt.label.slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (current.components.length > 0) rows.push(current);
  return rows;
}

/**
 * Convenience packaging for both `channel.send` and `message.edit` payloads.
 */
export function pollMessagePayload(poll: Poll) {
  return {
    embeds: [buildPollEmbed(poll)],
    components: buildPollComponents(poll),
  };
}
