import { feedFetchJson } from './http.js';
import type { FeedItem, FeedPollResult, FeedSubLite } from './types.js';

interface MastodonAccount {
  id: string;
  username: string;
  acct: string;
  display_name?: string;
  url?: string;
}

interface MastodonStatus {
  id: string;
  url?: string;
  uri?: string;
  content?: string; // HTML
  created_at?: string;
  account: MastodonAccount;
  reblog?: MastodonStatus | null;
  in_reply_to_id?: string | null;
  spoiler_text?: string;
}

interface ParsedAddress {
  user: string;
  instance: string;
}

function parseAddress(raw: string): ParsedAddress | null {
  // Accept "@user@instance.tld" or "user@instance.tld".
  const stripped = raw.startsWith('@') ? raw.slice(1) : raw;
  const at = stripped.indexOf('@');
  if (at < 1 || at === stripped.length - 1) return null;
  const user = stripped.slice(0, at);
  const instance = stripped.slice(at + 1);
  if (!user || !instance || instance.includes('/')) return null;
  return { user, instance };
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export async function fetchMastodonFeed(sub: FeedSubLite): Promise<FeedPollResult> {
  const addr = parseAddress(sub.identifier);
  if (!addr) throw new Error(`Invalid Mastodon address: ${sub.identifier}`);

  const base = `https://${addr.instance}`;
  const lookupUrl = `${base}/api/v1/accounts/lookup?acct=${encodeURIComponent(addr.user)}`;
  const account = await feedFetchJson<MastodonAccount>(lookupUrl, { accept: 'application/json' });

  const statusesUrl = `${base}/api/v1/accounts/${encodeURIComponent(account.id)}/statuses?limit=10&exclude_replies=true&exclude_reblogs=true`;
  const statuses = await feedFetchJson<MastodonStatus[]>(statusesUrl, {
    accept: 'application/json',
  });

  // The mastodon API returns newest-first.
  const items: FeedItem[] = statuses
    // Defensive: drop replies/reblogs even if the server ignored the filter.
    .filter((s) => !s.in_reply_to_id && !s.reblog)
    .map((s) => {
      const html = s.content ?? '';
      const text = stripHtml(html);
      const title = (s.spoiler_text || text || '(no text)').slice(0, 200);
      const link = s.url ?? s.uri ?? `${base}/@${account.acct}/${s.id}`;
      const item: FeedItem = {
        id: s.id,
        title,
        url: link,
        author: s.account.display_name
          ? `${s.account.display_name} (@${addr.user}@${addr.instance})`
          : `@${addr.user}@${addr.instance}`,
      };
      if (text) item.contentSnippet = text.slice(0, 300);
      if (s.created_at) {
        const d = new Date(s.created_at);
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
