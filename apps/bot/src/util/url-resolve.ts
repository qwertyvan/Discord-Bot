import { request } from 'undici';

const TIMEOUT_MS = 5_000;

// Walk up to `maxHops` Location redirects starting from `url`. Each hop issues
// a GET that does NOT auto-follow redirects (undici.request's default), so we
// can observe the chain ourselves — shorteners frequently respond to HEAD
// with 405. If the response isn't a 3xx (or there's no Location header), we
// return the current URL as the final resolved one.
//
// Errors and timeouts return the last-known URL so callers can fall back to
// scanning the original instead of blocking message delivery.
export async function resolveFinalUrl(url: string, maxHops = 3): Promise<string> {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await request(current, {
        method: 'GET',
        signal: controller.signal,
        // Drop the response body — we only need headers/status.
        bodyTimeout: TIMEOUT_MS,
        headersTimeout: TIMEOUT_MS,
      });
      // Consume the body to release the socket back to the pool.
      res.body.dump().catch(() => {});

      if (res.statusCode >= 300 && res.statusCode < 400) {
        const loc = res.headers['location'];
        const next = Array.isArray(loc) ? loc[0] : loc;
        if (!next) return current;
        try {
          current = new URL(next, current).toString();
        } catch {
          return current;
        }
        continue;
      }
      return current;
    } catch {
      return current;
    } finally {
      clearTimeout(timer);
    }
  }
  return current;
}
