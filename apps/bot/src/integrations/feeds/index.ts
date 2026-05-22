import type { FeedKind } from '@discord-bot/shared';
import type { FeedHandler } from './types.js';
import { fetchYoutubeFeed } from './youtube.js';
import { fetchRedditFeed } from './reddit.js';
import { fetchBlueskyFeed } from './bluesky.js';
import { fetchMastodonFeed } from './mastodon.js';

export const feedHandlers: Record<FeedKind, FeedHandler> = {
  youtube: fetchYoutubeFeed,
  reddit: fetchRedditFeed,
  bluesky: fetchBlueskyFeed,
  mastodon: fetchMastodonFeed,
};

export type { FeedHandler, FeedItem, FeedPollResult, FeedSubLite } from './types.js';
export { FEED_COLORS, FEED_KINDS } from './types.js';
