import { request } from 'undici';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

interface ThreatMatch {
  threatType: string;
  threat: { url: string };
}

/**
 * Check URLs against Google Safe Browsing v4. Returns the list of URLs that
 * were flagged. Returns an empty list if no credential is configured.
 *
 * Credential: `safebrowsing.api_key`.
 */
export async function checkUrls(guildId: string, urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  let key: string;
  try {
    const cred = await api.getIntegrationCredential(guildId, 'safebrowsing', 'api_key');
    key = cred.value;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
  const res = await request(
    `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'discord-bot', clientVersion: '0.16.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map((url) => ({ url })),
        },
      }),
    },
  );
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    log.warn('Safe Browsing returned non-2xx', { status: res.statusCode, body: body.slice(0, 200) });
    return [];
  }
  const json = (await res.body.json()) as { matches?: ThreatMatch[] };
  return (json.matches ?? []).map((m) => m.threat.url);
}
