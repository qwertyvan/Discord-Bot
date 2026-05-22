import { request } from 'undici';
import { log } from '../logger.js';

interface ThreatMatch {
  threatType: string;
  threat: { url: string };
}

// Reputation lookup against Google Safe Browsing v4 using the env-configured
// API key. We deliberately keep this separate from the per-guild credential
// flow used by the older automod scanner — link-safety is a server-wide
// feature so the operator opts in once via GOOGLE_SAFE_BROWSING_KEY.
//
// Returns the set of URLs the API flagged. A missing key or any failure
// (network error, non-2xx response) yields an empty set so the caller falls
// back to the local allow/blocklist verdict.
export async function checkSafeBrowsing(urls: string[]): Promise<Set<string>> {
  const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key || urls.length === 0) return new Set();
  try {
    const res = await request(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'discord-bot', clientVersion: '0.46.0' },
          threatInfo: {
            threatTypes: [
              'MALWARE',
              'SOCIAL_ENGINEERING',
              'UNWANTED_SOFTWARE',
              'POTENTIALLY_HARMFUL_APPLICATION',
            ],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: urls.map((url) => ({ url })),
          },
        }),
      },
    );
    if (res.statusCode >= 400) {
      const body = await res.body.text();
      log.warn('Safe Browsing returned non-2xx', {
        status: res.statusCode,
        body: body.slice(0, 200),
      });
      return new Set();
    }
    const json = (await res.body.json()) as { matches?: ThreatMatch[] };
    return new Set((json.matches ?? []).map((m) => m.threat.url));
  } catch (err) {
    log.warn('Safe Browsing check failed', { err: String(err) });
    return new Set();
  }
}
