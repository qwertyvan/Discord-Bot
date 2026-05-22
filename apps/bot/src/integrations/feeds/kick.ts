import { feedFetchJson } from './http.js';
import type { FeedItem, FeedPollResult, FeedSubLite } from './types.js';

interface KickLivestream {
  id?: number;
  slug?: string;
  session_title?: string;
  created_at?: string; // ISO
  is_live?: boolean;
  viewer_count?: number;
  thumbnail?: { url?: string } | null;
}

interface KickVideo {
  id?: number | string;
  uuid?: string;
  session_title?: string;
  created_at?: string;
  video?: { uuid?: string } | null;
}

interface KickChannel {
  id?: number;
  slug?: string;
  user?: { username?: string; bio?: string } | null;
  livestream?: KickLivestream | null;
  previous_livestreams?: KickVideo[] | null;
  recent_categories?: Array<{ name?: string }> | null;
}

function asUnix(iso: string | undefined): number {
  if (!iso) return 0;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
}

function latestVideoId(channel: KickChannel): string {
  const list = channel.previous_livestreams ?? [];
  const first = list[0];
  if (!first) return '';
  return String(first.uuid ?? first.id ?? first.video?.uuid ?? '');
}

/**
 * lastItemId encodes "<live_at_unix>-<latest_video_id>". A change in either
 * triggers a single embed: either the channel just went live, or a new VOD
 * was published.
 */
export async function fetchKickFeed(sub: FeedSubLite): Promise<FeedPollResult> {
  const slug = sub.identifier.trim().toLowerCase();
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
  const channel = await feedFetchJson<KickChannel>(url, { accept: 'application/json' });

  const live = channel.livestream;
  const isLive = !!live?.is_live;
  const liveUnix = isLive ? asUnix(live?.created_at) : 0;
  const videoId = latestVideoId(channel);
  const latestId = `${liveUnix}-${videoId}`;

  if (!sub.lastItemId) {
    return { newItems: [], latestId };
  }
  if (sub.lastItemId === latestId) {
    return { newItems: [], latestId };
  }

  const [prevLiveUnixStr, prevVideoId] = sub.lastItemId.split('-', 2);
  const prevLiveUnix = Number.parseInt(prevLiveUnixStr ?? '0', 10) || 0;

  const items: FeedItem[] = [];
  // A fresh livestream — only when crossing offline → online OR the live
  // session id (created_at) changed.
  if (isLive && liveUnix > 0 && liveUnix !== prevLiveUnix) {
    const username = channel.user?.username ?? slug;
    const item: FeedItem = {
      id: `live-${liveUnix}`,
      title: live?.session_title?.trim() || `${username} is live on Kick`,
      url: `https://kick.com/${encodeURIComponent(slug)}`,
      author: username,
    };
    const category = channel.recent_categories?.[0]?.name;
    if (category) item.contentSnippet = `Playing ${category}`;
    if (live?.created_at) {
      const d = new Date(live.created_at);
      if (!Number.isNaN(d.getTime())) item.publishedAt = d;
    }
    items.push(item);
  }

  // A new VOD/previous_livestream.
  if (videoId && videoId !== (prevVideoId ?? '')) {
    const first = channel.previous_livestreams?.[0];
    const username = channel.user?.username ?? slug;
    const vodId = String(first?.uuid ?? first?.id ?? videoId);
    const item: FeedItem = {
      id: `vod-${videoId}`,
      title: first?.session_title?.trim() || `${username} posted a new VOD`,
      url: `https://kick.com/${encodeURIComponent(slug)}/videos/${encodeURIComponent(vodId)}`,
      author: username,
    };
    if (first?.created_at) {
      const d = new Date(first.created_at);
      if (!Number.isNaN(d.getTime())) item.publishedAt = d;
    }
    items.push(item);
  }

  return { newItems: items, latestId };
}
