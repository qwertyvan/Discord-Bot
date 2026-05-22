import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TimestampStyles,
  time,
} from 'discord.js';
import type { Giveaway } from '@discord-bot/shared';

const STATUS_COLOR: Record<Giveaway['status'], number> = {
  active: 0x5865f2,
  ended: 0x57f287,
  cancelled: 0xed4245,
};

const STATUS_LABEL: Record<Giveaway['status'], string> = {
  active: '🎉 Giveaway',
  ended: '🏁 Giveaway · Ended',
  cancelled: '🛑 Giveaway · Cancelled',
};

export function buildGiveawayEmbed(g: Giveaway, entryCount: number): EmbedBuilder {
  const endsAt = new Date(g.endsAt);
  const embed = new EmbedBuilder()
    .setTitle(STATUS_LABEL[g.status])
    .setColor(STATUS_COLOR[g.status])
    .setDescription(`**Prize:** ${g.prize}`)
    .addFields(
      {
        name: g.status === 'active' ? 'Ends' : 'Ended',
        value:
          g.status === 'active'
            ? `${time(endsAt, TimestampStyles.LongDateTime)} (${time(endsAt, TimestampStyles.RelativeTime)})`
            : time(endsAt, TimestampStyles.LongDateTime),
        inline: true,
      },
      { name: 'Winners', value: String(g.winnerCount), inline: true },
      { name: 'Entries', value: String(entryCount), inline: true },
      { name: 'Hosted by', value: `<@${g.hostId}>`, inline: true },
    );

  const requirements: string[] = [];
  if (g.requireRoleId) requirements.push(`Must have <@&${g.requireRoleId}>`);
  if (g.requireMinLevel !== null && g.requireMinLevel !== undefined) {
    requirements.push(`Min level **${g.requireMinLevel}**`);
  }
  if (g.weightedBonusRoles.length > 0) {
    requirements.push(
      `Bonus entries per role: ${g.weightedBonusRoles.map((r) => `<@&${r}>`).join(', ')}`,
    );
  }
  if (requirements.length > 0) {
    embed.addFields({ name: 'Requirements', value: requirements.join('\n') });
  }

  if (g.status === 'ended') {
    const list =
      g.winners.length > 0
        ? g.winners.map((w) => `<@${w.userId}>`).join(', ')
        : '*No eligible entries — nobody won.*';
    embed.addFields({ name: 'Winners', value: list });
  } else if (g.status === 'cancelled') {
    embed.addFields({ name: 'Status', value: 'This giveaway was cancelled.' });
  }

  embed.setFooter({ text: `Giveaway ${g.id}` });
  embed.setTimestamp(new Date(g.createdAt));
  return embed;
}

export function buildGiveawayComponents(g: Giveaway): ActionRowBuilder<ButtonBuilder>[] {
  if (g.status !== 'active') return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`gw:enter:${g.id}`)
        .setLabel('🎉 Enter')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export function giveawayMessagePayload(g: Giveaway, entryCount: number) {
  return {
    embeds: [buildGiveawayEmbed(g, entryCount)],
    components: buildGiveawayComponents(g),
  };
}
