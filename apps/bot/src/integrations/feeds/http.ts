import { request, type Dispatcher } from 'undici';

const TIMEOUT_MS = 10_000;
const USER_AGENT = 'discord-bot/v0.35 by qwertyvan';

export interface FeedHttpOptions {
  headers?: Record<string, string>;
  accept?: string;
}

/**
 * Tight wrapper around undici.request that enforces a 10-second timeout
 * and a polite User-Agent (Reddit blocks the default UA outright).
 * Throws on any non-2xx response; callers are expected to catch.
 */
export async function feedRequest(
  url: string,
  opts: FeedHttpOptions = {},
): Promise<Dispatcher.ResponseData> {
  const res = await request(url, {
    method: 'GET',
    headers: {
      'user-agent': USER_AGENT,
      ...(opts.accept ? { accept: opts.accept } : {}),
      ...opts.headers,
    },
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
  });
  return res;
}

export async function feedFetchText(url: string, opts: FeedHttpOptions = {}): Promise<string> {
  const res = await feedRequest(url, opts);
  if (res.statusCode >= 400) {
    // Drain so the pool doesn't stall.
    await res.body.text().catch(() => '');
    throw new Error(`${url} returned ${res.statusCode}`);
  }
  return res.body.text();
}

export async function feedFetchJson<T>(url: string, opts: FeedHttpOptions = {}): Promise<T> {
  const res = await feedRequest(url, opts);
  if (res.statusCode >= 400) {
    await res.body.text().catch(() => '');
    throw new Error(`${url} returned ${res.statusCode}`);
  }
  return (await res.body.json()) as T;
}
