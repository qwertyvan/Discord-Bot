import { request } from 'undici';
import { log } from '../../logger.js';
import type { FeedItem, FeedPollResult, FeedSubLite } from './types.js';

const TIMEOUT_MS = 10_000;
const USER_AGENT = 'discord-bot/v0.48 by qwertyvan';

interface TrovoChannel {
  is_live?: boolean;
  category_name?: string;
  live_title?: string;
  started_at?: string; // unix seconds (string) per docs
  username?: string;
  channel_url?: string;
  thumbnail?: string;
}

let warnedMissingClientId = false;

/**
 * Trovo's public channel info endpoint requires a Client-ID header. We
 * source it from TROVO_CLIENT_ID. Without it we no-op gracefully so
 * subscriptions remain valid but inert.
 */
export async function fetchTrovoFeed(sub: FeedSubLite): Promise<FeedPollResult> {
  const clientId = process.env.TROVO_CLIENT_ID;
  if (!clientId) {
    if (!warnedMissingClientId) {
      log.warn('TROVO_CLIENT_ID not set — Trovo feeds will be skipped.');
      warnedMissingClientId = true;
    }
    return { newItems: [], latestId: sub.lastItemId };
  }

  const res = await request('https://api.trovo.live/openplatform/channels/id', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'client-id': clientId,
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify({ username: sub.identifier }),
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
  });
  if (res.statusCode >= 400) {
    await res.body.text().catch(() => '');
    throw new Error(`Trovo channels/id returned ${res.statusCode}`);
  }
  const channel = (await res.body.json()) as TrovoChannel;

  const isLive = !!channel.is_live;
  const startedRaw = channel.started_at ?? '';
  const startedUnix = isLive ? Number.parseInt(startedRaw, 10) || 0 : 0;
  const latestId = `${startedUnix}`;

  if (!sub.lastItemId) {
    return { newItems: [], latestId };
  }
  if (latestId === sub.lastItemId) {
    return { newItems: [], latestId };
  }

  const items: FeedItem[] = [];
  if (isLive && startedUnix > 0) {
    const username = channel.username ?? sub.identifier;
    const url = channel.channel_url ?? `https://trovo.live/s/${encodeURIComponent(sub.identifier)}`;
    const item: FeedItem = {
      id: `live-${startedUnix}`,
      title: channel.live_title?.trim() || `${username} is live on Trovo`,
      url,
      author: username,
    };
    if (channel.category_name) item.contentSnippet = `Playing ${channel.category_name}`;
    const startedAt = new Date(startedUnix * 1000);
    if (!Number.isNaN(startedAt.getTime())) item.publishedAt = startedAt;
    items.push(item);
  }

  return { newItems: items, latestId };
}
