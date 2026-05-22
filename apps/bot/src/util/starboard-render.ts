import { EmbedBuilder } from 'discord.js';
import type { StarboardEntry } from '@discord-bot/shared';

export interface StarboardAuthorMeta {
  displayName: string;
  avatarUrl: string;
}

export interface BuildStarboardEmbedOptions {
  entry: StarboardEntry;
  emoji: string;
  sourceMessageLink: string;
  author?: StarboardAuthorMeta;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp)(?:\?.*)?$/i;

export function buildStarboardEmbed(opts: BuildStarboardEmbedOptions): EmbedBuilder {
  const { entry, emoji, sourceMessageLink, author } = opts;
  const embed = new EmbedBuilder()
    .setColor(0xffac33)
    .setTitle(`${emoji} × ${entry.starCount}`)
    .setURL(sourceMessageLink)
    .setTimestamp(new Date(entry.firstStarredAt));

  if (entry.content && entry.content.length > 0) {
    embed.setDescription(entry.content);
  }

  embed.addFields({
    name: 'Source',
    value: `[Jump to message](${sourceMessageLink})`,
    inline: false,
  });

  if (author) {
    embed.setAuthor({ name: author.displayName, iconURL: author.avatarUrl });
  } else {
    embed.setAuthor({ name: `<@${entry.authorId}>` });
  }

  if (entry.attachmentUrl && IMAGE_RE.test(entry.attachmentUrl)) {
    embed.setImage(entry.attachmentUrl);
  }

  embed.setFooter({ text: `#${entry.channelId}` });

  return embed;
}

export function starboardMessagePayload(opts: BuildStarboardEmbedOptions) {
  return { embeds: [buildStarboardEmbed(opts)] };
}

export function buildStarboardDigestEmbed(opts: {
  entries: StarboardEntry[];
  emoji: string;
  guildId: string;
  days: number;
}): EmbedBuilder {
  const { entries, emoji, guildId, days } = opts;
  const lines = entries.map((e, i) => {
    const link = `https://discord.com/channels/${guildId}/${e.channelId}/${e.sourceMessageId}`;
    const snippet =
      e.content.length > 120 ? `${e.content.slice(0, 117).trimEnd()}…` : e.content || '*(no text)*';
    return `**#${i + 1}** ${emoji} × ${e.starCount} — <@${e.authorId}> · [jump](${link})\n${snippet}`;
  });
  return new EmbedBuilder()
    .setColor(0xffac33)
    .setTitle(`${emoji} Top quotes of the last ${days} days`)
    .setDescription(lines.length > 0 ? lines.join('\n\n') : '*No starred messages this week.*')
    .setTimestamp(new Date());
}
