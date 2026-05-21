import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TimestampStyles,
  time,
} from 'discord.js';
import type { Event } from '@discord-bot/shared';

export function buildEventEmbed(event: Event): EmbedBuilder {
  const startsAt = new Date(event.startsAt);
  const embed = new EmbedBuilder()
    .setTitle(`📅 ${event.title}`)
    .setColor(0x5865f2)
    .addFields(
      { name: 'When', value: time(startsAt, TimestampStyles.LongDateTime) },
      {
        name: 'In',
        value: time(startsAt, TimestampStyles.RelativeTime),
        inline: true,
      },
    );
  if (event.endsAt) {
    embed.addFields({
      name: 'Ends',
      value: time(new Date(event.endsAt), TimestampStyles.RelativeTime),
      inline: true,
    });
  }
  if (event.location) {
    embed.addFields({ name: 'Where', value: event.location, inline: false });
  }
  if (event.description) {
    embed.setDescription(event.description);
  }
  embed.addFields({
    name: 'RSVPs',
    value: `✅ ${event.counts.yes} · 🤔 ${event.counts.maybe} · ❌ ${event.counts.no}`,
  });
  embed.setFooter({ text: `Event id ${event.id}` });
  return embed;
}

export function buildEventComponents(event: Event): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`rsvp:yes:${event.id}`)
      .setLabel(`Yes (${event.counts.yes})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rsvp:maybe:${event.id}`)
      .setLabel(`Maybe (${event.counts.maybe})`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rsvp:no:${event.id}`)
      .setLabel(`No (${event.counts.no})`)
      .setStyle(ButtonStyle.Danger),
  );
  return [row];
}

export function eventMessagePayload(event: Event) {
  return {
    embeds: [buildEventEmbed(event)],
    components: buildEventComponents(event),
  };
}
