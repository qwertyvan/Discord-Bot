import {
  ChannelType,
  Events,
  type Client,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type TextChannel,
  type User,
} from 'discord.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';
import type { StarboardConfig } from '@discord-bot/shared';
import {
  buildStarboardEmbed,
  type StarboardAuthorMeta,
} from '../util/starboard-render.js';

interface ConfigCacheEntry {
  fetchedAt: number;
  config: StarboardConfig | null;
}

const CONFIG_TTL_MS = 60_000;
const configCache = new Map<string, ConfigCacheEntry>();

export function invalidateStarboardConfigCache(guildId: string): void {
  configCache.delete(guildId);
}

async function getCachedConfig(guildId: string): Promise<StarboardConfig | null> {
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < CONFIG_TTL_MS) return cached.config;
  let config: StarboardConfig | null = null;
  try {
    config = await api.getStarboardConfig(guildId);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) {
      log.warn('getStarboardConfig failed', { guildId, err: String(err) });
    }
  }
  configCache.set(guildId, { fetchedAt: Date.now(), config });
  return config;
}

function emojiMatches(
  reaction: MessageReaction | PartialMessageReaction,
  configured: string,
): boolean {
  const emoji = reaction.emoji;
  // Custom emoji: <:name:id> or just `name`. Allow matching by id, name, or
  // the full "<a?:name:id>" form.
  if (emoji.id) {
    if (configured === emoji.id) return true;
    if (configured === emoji.name) return true;
    if (configured === emoji.toString()) return true;
    return false;
  }
  // Unicode emoji.
  return emoji.name === configured;
}

async function ensureFullReaction(
  reaction: MessageReaction | PartialMessageReaction,
): Promise<MessageReaction | null> {
  if (reaction.partial) {
    try {
      return await reaction.fetch();
    } catch {
      return null;
    }
  }
  return reaction;
}

async function ensureFullMessage(
  reaction: MessageReaction,
): Promise<Message | null> {
  const msg = reaction.message;
  if (msg.partial) {
    try {
      return await msg.fetch();
    } catch {
      return null;
    }
  }
  return msg as Message;
}

async function countUniqueReactors(reaction: MessageReaction): Promise<number> {
  // discord.js exposes .count which includes the bot itself if it reacted.
  // For starboard purposes we accept the raw count — the bot doesn't seed
  // reactions on user messages.
  try {
    const users = await reaction.users.fetch();
    return users.filter((u) => !u.bot).size;
  } catch {
    return reaction.count ?? 0;
  }
}

function sourceMessageLink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function pickAttachment(message: Message): string | null {
  const att = message.attachments.first();
  return att?.url ?? null;
}

function authorMetaFromMessage(message: Message): StarboardAuthorMeta {
  const member = message.member;
  const displayName = member?.displayName ?? message.author.username;
  const avatarUrl = message.author.displayAvatarURL({ size: 128, extension: 'png' });
  return { displayName, avatarUrl };
}

async function handleReactionChange(
  client: Client,
  rawReaction: MessageReaction | PartialMessageReaction,
  rawUser: User | PartialUser,
): Promise<void> {
  if (rawUser.bot) return;
  const reaction = await ensureFullReaction(rawReaction);
  if (!reaction) return;
  const message = await ensureFullMessage(reaction);
  if (!message || !message.guildId || !message.inGuild()) return;

  const config = await getCachedConfig(message.guildId);
  if (!config || !config.enabled || !config.channelId) return;
  if (!emojiMatches(reaction, config.emoji)) return;

  // NSFW gating: skip messages from NSFW channels unless allowed.
  const sourceChannel = message.channel;
  if (
    !config.allowNsfw &&
    'nsfw' in sourceChannel &&
    sourceChannel.nsfw === true
  ) {
    return;
  }

  // Don't pin the bot's own messages or messages from the starboard channel.
  if (message.author.id === client.user?.id) return;
  if (message.channelId === config.channelId) return;

  const starCount = await countUniqueReactors(reaction);
  const attachmentUrl = pickAttachment(message);
  let entry;
  try {
    entry = await api.recordStar(message.guildId, {
      sourceMessageId: message.id,
      authorId: message.author.id,
      channelId: message.channelId,
      starCount,
      content: (message.content ?? '').slice(0, 2000),
      ...(attachmentUrl !== undefined ? { attachmentUrl } : {}),
    });
  } catch (err) {
    log.warn('recordStar failed', { guildId: message.guildId, err: String(err) });
    return;
  }

  const guild = client.guilds.cache.get(message.guildId);
  if (!guild) return;
  const starboardChannel = guild.channels.cache.get(config.channelId);
  if (!starboardChannel || starboardChannel.type !== ChannelType.GuildText) return;

  const link = sourceMessageLink(message.guildId, message.channelId, message.id);
  const embed = buildStarboardEmbed({
    entry,
    emoji: config.emoji,
    sourceMessageLink: link,
    author: authorMetaFromMessage(message),
  });

  if (entry.starboardMessageId) {
    // Edit existing pinned message to reflect new count.
    try {
      const sb = await (starboardChannel as TextChannel).messages
        .fetch(entry.starboardMessageId)
        .catch(() => null);
      if (sb) {
        await sb.edit({ embeds: [embed] });
      } else {
        // Original starboard message is gone; clear the link.
        await api
          .setStarboardMessageId(message.guildId, message.id, { starboardMessageId: null })
          .catch(() => {});
      }
    } catch (err) {
      log.warn('Starboard edit failed', { guildId: message.guildId, err: String(err) });
    }
    return;
  }

  // Not yet pinned — check threshold.
  if (entry.starCount < config.threshold) return;

  try {
    const sent = await (starboardChannel as TextChannel).send({ embeds: [embed] });
    await api.setStarboardMessageId(message.guildId, message.id, {
      starboardMessageId: sent.id,
    });
  } catch (err) {
    log.warn('Starboard post failed', { guildId: message.guildId, err: String(err) });
  }
}

export function registerStarboardEvents(client: Client): void {
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    handleReactionChange(client, reaction, user).catch((err) =>
      log.warn('Starboard reaction-add handler failed', { err: String(err) }),
    );
  });
  client.on(Events.MessageReactionRemove, (reaction, user) => {
    handleReactionChange(client, reaction, user).catch((err) =>
      log.warn('Starboard reaction-remove handler failed', { err: String(err) }),
    );
  });
}
