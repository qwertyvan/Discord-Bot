import { feedFetchJson } from './http.js';
import type { FeedItem, FeedPollResult, FeedSubLite } from './types.js';

interface RedditPost {
  id: string;
  name: string; // fullname e.g. "t3_abc"
  title: string;
  permalink: string;
  url: string;
  author: string;
  selftext?: string;
  created_utc?: number;
  over_18?: boolean;
  stickied?: boolean;
}

interface RedditListing {
  data?: { children?: Array<{ data?: RedditPost }> };
}

export async function fetchRedditFeed(sub: FeedSubLite): Promise<FeedPollResult> {
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub.identifier)}/new.json?limit=10`;
  const json = await feedFetchJson<RedditListing>(url, {
    accept: 'application/json',
  });
  const children = json.data?.children ?? [];
  const items: FeedItem[] = children
    .map((c) => c.data)
    .filter((d): d is RedditPost => !!d && !d.stickied)
    .map((d) => {
      const item: FeedItem = {
        id: d.name || `t3_${d.id}`,
        title: d.title,
        url: `https://www.reddit.com${d.permalink}`,
        author: `u/${d.author}`,
      };
      const snippet = (d.selftext ?? '').trim();
      if (snippet) item.contentSnippet = snippet.slice(0, 300);
      if (typeof d.created_utc === 'number') item.publishedAt = new Date(d.created_utc * 1000);
      return item;
    });

  // Listings are newest-first.
  if (items.length === 0) return { newItems: [], latestId: sub.lastItemId };
  const latestId = items[0]?.id ?? null;
  if (!sub.lastItemId) return { newItems: [], latestId };
  const fresh: FeedItem[] = [];
  for (const it of items) {
    if (it.id === sub.lastItemId) break;
    fresh.push(it);
  }
  return { newItems: fresh, latestId };
}
