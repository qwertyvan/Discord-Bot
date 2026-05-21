import { Events, type Client } from 'discord.js';
import { api, ApiError } from '../api-client.js';

interface CacheEntry {
  fetchedAt: number;
  isTicket: boolean;
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry>(); // key: `${guildId}:${channelId}`

async function isTicketChannel(guildId: string, channelId: string): Promise<boolean> {
  const key = `${guildId}:${channelId}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.isTicket;
  try {
    await api.getTicketByChannel(guildId, channelId);
    cache.set(key, { fetchedAt: Date.now(), isTicket: true });
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      cache.set(key, { fetchedAt: Date.now(), isTicket: false });
      return false;
    }
    return false;
  }
}

/**
 * Track activity in ticket threads. On every non-bot message, lookup
 * whether the channel is a ticket (cached per (guild, channel) for 5 min)
 * and bump the activity timestamp. The cached negative response means
 * non-ticket channels cost one API call every 5 minutes per channel they
 * have traffic in.
 */
export function registerTicketActivityEvents(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || !message.guildId || message.author.bot) return;
    if (!(await isTicketChannel(message.guildId, message.channelId))) return;
    await api.bumpTicketActivity(message.guildId, message.channelId).catch(() => {});
  });
}

export function invalidateTicketCache(guildId: string, channelId: string): void {
  cache.delete(`${guildId}:${channelId}`);
}
