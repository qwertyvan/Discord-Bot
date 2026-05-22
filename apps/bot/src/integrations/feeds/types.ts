import type { FeedKind } from '@discord-bot/shared';

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  author?: string;
  contentSnippet?: string;
  publishedAt?: Date;
}

export interface FeedPollResult {
  newItems: FeedItem[];
  latestId: string | null;
}

export interface FeedSubLite {
  id: string;
  guildId: string;
  channelId: string;
  identifier: string;
  lastItemId: string | null;
}

export type FeedHandler = (sub: FeedSubLite) => Promise<FeedPollResult>;

export const FEED_KINDS: readonly FeedKind[] = ['youtube', 'reddit', 'bluesky', 'mastodon'];

export const FEED_COLORS: Record<FeedKind, number> = {
  youtube: 0xff0000,
  reddit: 0xff4500,
  bluesky: 0x0085ff,
  mastodon: 0x6364ff,
};
