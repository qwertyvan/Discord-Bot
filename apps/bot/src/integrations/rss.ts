import { XMLParser } from 'fast-xml-parser';

export interface RssItem {
  guid: string;
  title: string;
  link?: string;
  pubDate?: Date;
  summary?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  processEntities: true,
});

interface ParsedNode {
  [key: string]: unknown;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && '#text' in v && typeof (v as ParsedNode)['#text'] === 'string') {
    return (v as { '#text': string })['#text'];
  }
  if (v && typeof v === 'object' && '@href' in v && typeof (v as ParsedNode)['@href'] === 'string') {
    return (v as { '@href': string })['@href'];
  }
  return '';
}

function ensureArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Fetch an RSS 2.0 or Atom feed and return items in feed order (newest first).
 * Discards the body if the HTTP fetch fails. Tolerates malformed feeds.
 */
export async function fetchFeed(url: string): Promise<RssItem[]> {
  const res = await fetch(url, {
    headers: { accept: 'application/atom+xml, application/rss+xml, application/xml' },
  });
  if (!res.ok) throw new Error(`Feed ${url} returned ${res.status}`);
  const xml = await res.text();
  const data = parser.parse(xml) as ParsedNode;

  const rss = data.rss as ParsedNode | undefined;
  if (rss?.channel) {
    const channel = rss.channel as ParsedNode;
    return ensureArray(channel.item as ParsedNode | ParsedNode[] | undefined).map((it) => ({
      guid: asString(it.guid) || asString(it.link) || asString(it.title),
      title: asString(it.title),
      ...(asString(it.link) ? { link: asString(it.link) } : {}),
      ...(asString(it.pubDate) ? { pubDate: new Date(asString(it.pubDate)) } : {}),
      ...(asString(it.description)
        ? { summary: stripTags(asString(it.description)).slice(0, 300) }
        : {}),
    }));
  }

  const atom = data.feed as ParsedNode | undefined;
  if (atom) {
    return ensureArray(atom.entry as ParsedNode | ParsedNode[] | undefined).map((it) => ({
      guid: asString(it.id) || asString(it.link) || asString(it.title),
      title: asString(it.title),
      ...(asString(it.link) ? { link: asString(it.link) } : {}),
      ...(asString(it.updated || it.published)
        ? { pubDate: new Date(asString(it.updated || it.published)) }
        : {}),
      ...(asString(it.summary)
        ? { summary: stripTags(asString(it.summary)).slice(0, 300) }
        : {}),
    }));
  }

  return [];
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}
