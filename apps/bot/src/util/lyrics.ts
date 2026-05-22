import { request } from 'undici';

const LYRICS_TIMEOUT_MS = 5_000;

/**
 * Best-effort fetch of lyrics from the free, no-key lyrics.ovh API.
 *
 * Accepts:
 *   - "Artist - Title"  (preferred)
 *   - "Title"           (artist is left blank; the API still returns hits sometimes)
 *
 * Returns the lyrics text trimmed to a sensible length, or `null` if no match
 * was found / the request timed out / the upstream is down. Never throws.
 */
export async function fetchLyrics(query: string): Promise<string | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  let artist = '';
  let title = trimmed;
  const dashIdx = trimmed.indexOf(' - ');
  if (dashIdx > 0) {
    artist = trimmed.slice(0, dashIdx).trim();
    title = trimmed.slice(dashIdx + 3).trim();
  }
  if (!title) return null;

  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LYRICS_TIMEOUT_MS);

  try {
    const res = await request(url, { signal: controller.signal });
    if (res.statusCode !== 200) {
      // Drain body to free the socket.
      await res.body.dump().catch(() => undefined);
      return null;
    }
    const body = (await res.body.json()) as { lyrics?: unknown } | null;
    if (!body || typeof body.lyrics !== 'string') return null;
    const lyrics = body.lyrics.trim();
    if (!lyrics) return null;
    return lyrics;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
