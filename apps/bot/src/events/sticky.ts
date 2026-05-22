import { ChannelType, Events, type Client } from 'discord.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

interface ChannelState {
  fetchedAt: number;
  sticky: {
    content: string;
    lastMessageId: string | null;
    throttleMessages: number;
    enabled: boolean;
  } | null;
  // Count of user messages observed since the last (re)post.
  sinceLastPost: number;
}

const TTL_MS = 60_000;
const state = new Map<string, ChannelState>(); // key: `${guildId}:${channelId}`

async function getStickyState(guildId: string, channelId: string): Promise<ChannelState> {
  const key = `${guildId}:${channelId}`;
  const cached = state.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  let stickyData: ChannelState['sticky'] = null;
  try {
    const s = await api.getStickyMessage(guildId, channelId);
    stickyData = {
      content: s.content,
      lastMessageId: s.lastMessageId,
      throttleMessages: s.throttleMessages,
      enabled: s.enabled,
    };
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      log.warn('Sticky fetch failed', { guildId, channelId, err: String(err) });
    }
  }
  const entry: ChannelState = {
    fetchedAt: Date.now(),
    sticky: stickyData,
    sinceLastPost: cached?.sinceLastPost ?? 0,
  };
  state.set(key, entry);
  return entry;
}

export function invalidateStickyCache(guildId: string, channelId: string): void {
  state.delete(`${guildId}:${channelId}`);
}

export function registerStickyEvents(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || !message.guildId || message.author.bot) return;
    const cur = await getStickyState(message.guildId, message.channelId);
    if (!cur.sticky?.enabled) return;
    cur.sinceLastPost++;
    if (cur.sinceLastPost < cur.sticky.throttleMessages) return;
    // Re-post: delete previous instance, send new one, persist new id.
    try {
      const channel = message.channel;
      if (channel.type !== ChannelType.GuildText) return;
      if (cur.sticky.lastMessageId) {
        await channel.messages
          .delete(cur.sticky.lastMessageId)
          .catch(() => {});
      }
      const sent = await channel.send({
        content: `📌 ${cur.sticky.content}`,
        allowedMentions: { parse: [] },
      });
      const newId = sent.id;
      cur.sticky.lastMessageId = newId;
      cur.sinceLastPost = 0;
      await api
        .updateStickyLastMessage(message.guildId, message.channelId, { lastMessageId: newId })
        .catch(() => {});
    } catch (err) {
      log.warn('Sticky re-post failed', {
        guildId: message.guildId,
        channelId: message.channelId,
        err: String(err),
      });
    }
  });
}
