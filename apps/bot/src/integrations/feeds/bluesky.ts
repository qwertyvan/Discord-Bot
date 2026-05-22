import { feedFetchJson } from './http.js';
import type { FeedItem, FeedPollResult, FeedSubLite } from './types.js';

interface BskyProfile {
  did?: string;
  handle?: string;
  displayName?: string;
}

interface BskyPostRecord {
  text?: string;
  createdAt?: string;
}

interface BskyPost {
  uri: string; // at://did/app.bsky.feed.post/<rkey>
  cid: string;
  author: BskyProfile;
  record: BskyPostRecord;
  indexedAt?: string;
}

interface BskyFeedEntry {
  post: BskyPost;
  reason?: { $type?: string }; // skip reposts
}

interface BskyFeedResponse {
  feed?: BskyFeedEntry[];
}

function postUrlFromUri(uri: string, fallbackHandle: string): string {
  // at://did/app.bsky.feed.post/<rkey>  →  https://bsky.app/profile/<handle>/post/<rkey>
  const match = uri.match(/\/app\.bsky\.feed\.post\/([^/]+)$/);
  const rkey = match?.[1] ?? '';
  return `https://bsky.app/profile/${fallbackHandle}/post/${rkey}`;
}

export async function fetchBlueskyFeed(sub: FeedSubLite): Promise<FeedPollResult> {
  const url =
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed` +
    `?actor=${encodeURIComponent(sub.identifier)}&limit=10`;
  const json = await feedFetchJson<BskyFeedResponse>(url, { accept: 'application/json' });
  const entries = json.feed ?? [];

  const items: FeedItem[] = entries
    // Drop reposts so we only announce original posts by this account.
    .filter((e) => !e.reason)
    .map((e) => {
      const p = e.post;
      const text = (p.record.text ?? '').trim();
      const title = text.length > 0 ? text.slice(0, 200) : '(no text)';
      const handle = p.author.handle ?? sub.identifier;
      const item: FeedItem = {
        id: p.cid,
        title,
        url: postUrlFromUri(p.uri, handle),
        author: p.author.displayName ? `${p.author.displayName} (@${handle})` : `@${handle}`,
      };
      if (text) item.contentSnippet = text.slice(0, 300);
      const created = p.record.createdAt ?? p.indexedAt;
      if (created) {
        const d = new Date(created);
        if (!Number.isNaN(d.getTime())) item.publishedAt = d;
      }
      return item;
    });

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
