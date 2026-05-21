import { request } from 'undici';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

interface SightengineResponse {
  status: string;
  nudity?: { sexual_activity?: number; sexual_display?: number; erotica?: number; suggestive?: number };
  weapon?: number;
}

export interface NsfwResult {
  flagged: boolean;
  highestScore: number;
  reason?: string;
}

const DEFAULT_THRESHOLD = 0.5;

/**
 * Classify an image URL via Sightengine. Returns flagged=true when the
 * configured threshold is exceeded for sexual content. Returns null (no
 * decision) when credentials aren't configured.
 *
 * Credentials: `sightengine.api_user`, `sightengine.api_secret`.
 * Optional credential `sightengine.threshold` (string-encoded float).
 */
export async function classifyImage(
  guildId: string,
  imageUrl: string,
): Promise<NsfwResult | null> {
  let apiUser: string;
  let apiSecret: string;
  try {
    const [userCred, secretCred] = await Promise.all([
      api.getIntegrationCredential(guildId, 'sightengine', 'api_user'),
      api.getIntegrationCredential(guildId, 'sightengine', 'api_secret'),
    ]);
    apiUser = userCred.value;
    apiSecret = secretCred.value;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
  let threshold = DEFAULT_THRESHOLD;
  try {
    const cred = await api.getIntegrationCredential(guildId, 'sightengine', 'threshold');
    const parsed = Number(cred.value);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) threshold = parsed;
  } catch {
    // optional credential — fine to skip
  }

  const url = new URL('https://api.sightengine.com/1.0/check.json');
  url.searchParams.set('url', imageUrl);
  url.searchParams.set('models', 'nudity-2.1');
  url.searchParams.set('api_user', apiUser);
  url.searchParams.set('api_secret', apiSecret);

  const res = await request(url);
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    log.warn('Sightengine returned non-2xx', { status: res.statusCode, body: body.slice(0, 200) });
    return { flagged: false, highestScore: 0 };
  }
  const json = (await res.body.json()) as SightengineResponse;
  const scores = {
    sexual_activity: json.nudity?.sexual_activity ?? 0,
    sexual_display: json.nudity?.sexual_display ?? 0,
    erotica: json.nudity?.erotica ?? 0,
  };
  const highest = Math.max(...Object.values(scores));
  const flagged = highest >= threshold;
  const reason = flagged
    ? `NSFW score ${highest.toFixed(2)} ≥ threshold ${threshold.toFixed(2)}`
    : undefined;
  return { flagged, highestScore: highest, ...(reason ? { reason } : {}) };
}
