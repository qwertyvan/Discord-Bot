import { XMLParser } from 'fast-xml-parser';
import { feedFetchText } from './http.js';
import type { FeedItem, FeedPollResult, FeedSubLite } from './types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  processEntities: true,
});

interface AtomLink {
  '@href'?: string;
  '@rel'?: string;
}

interface AtomEntry {
  id?: unknown;
  title?: unknown;
  link?: AtomLink | AtomLink[];
  published?: unknown;
  updated?: unknown;
  author?: { name?: unknown } | undefined;
  'media:group'?: { 'media:description'?: unknown } | undefined;
  'yt:videoId'?: unknown;
}

interface AtomFeed {
  feed?: { entry?: AtomEntry | AtomEntry[] };
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && '#text' in v) {
    const t = (v as { '#text': unknown })['#text'];
    return typeof t === 'string' ? t : '';
  }
  return '';
}

function pickLink(link: AtomLink | AtomLink[] | undefined): string {
  if (!link) return '';
  const arr = Array.isArray(link) ? link : [link];
  // Prefer rel="alternate" (the watch page).
  for (const l of arr) {
    if (l['@rel'] === 'alternate' && l['@href']) return l['@href'];
  }
  return arr[0]?.['@href'] ?? '';
}

export async function fetchYoutubeFeed(sub: FeedSubLite): Promise<FeedPollResult> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(
    sub.identifier,
  )}`;
  const xml = await feedFetchText(url, {
    accept: 'application/atom+xml, application/xml',
  });
  const parsed = parser.parse(xml) as AtomFeed;
  const rawEntries = parsed.feed?.entry;
  const entries: AtomEntry[] = !rawEntries
    ? []
    : Array.isArray(rawEntries)
      ? rawEntries
      : [rawEntries];

  // YouTube's atom feed is newest-first.
  const items: FeedItem[] = entries.map((e) => {
    const videoId = asString(e['yt:videoId']) || asString(e.id);
    const link = pickLink(e.link) || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
    const author = e.author?.name ? asString(e.author.name) : undefined;
    const desc = asString(e['media:group']?.['media:description']);
    const publishedRaw = asString(e.published) || asString(e.updated);
    const publishedAt = publishedRaw ? new Date(publishedRaw) : undefined;
    const item: FeedItem = {
      id: videoId || link,
      title: asString(e.title) || '(untitled)',
      url: link,
    };
    if (author) item.author = author;
    if (desc) item.contentSnippet = desc.slice(0, 300);
    if (publishedAt && !Number.isNaN(publishedAt.getTime())) item.publishedAt = publishedAt;
    return item;
  });

  return diffNewest(items, sub.lastItemId);
}

function diffNewest(items: FeedItem[], lastId: string | null): FeedPollResult {
  if (items.length === 0) return { newItems: [], latestId: lastId };
  const latestId = items[0]?.id ?? null;
  if (!lastId) return { newItems: [], latestId };
  const fresh: FeedItem[] = [];
  for (const it of items) {
    if (it.id === lastId) break;
    fresh.push(it);
  }
  return { newItems: fresh, latestId };
}
