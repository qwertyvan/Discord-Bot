import { request } from 'undici';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

interface AppToken {
  accessToken: string;
  expiresAt: number;
}

interface TokenCache {
  token: AppToken | null;
  fetchedFor: string; // clientId we fetched the token for
}

const tokenCache = new Map<string, TokenCache>(); // key: guildId
const ABOUT_TO_EXPIRE_MS = 60_000;

async function fetchAppToken(clientId: string, clientSecret: string): Promise<AppToken> {
  const res = await request('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }).toString(),
  });
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`Twitch token endpoint returned ${res.statusCode}: ${body}`);
  }
  const json = (await res.body.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in ?? 0) * 1000,
  };
}

async function getCredentials(guildId: string): Promise<{ clientId: string; clientSecret: string } | null> {
  try {
    const [id, secret] = await Promise.all([
      api.getIntegrationCredential(guildId, 'twitch', 'client_id'),
      api.getIntegrationCredential(guildId, 'twitch', 'client_secret'),
    ]);
    return { clientId: id.value, clientSecret: secret.value };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function getToken(guildId: string): Promise<{ token: string; clientId: string } | null> {
  const creds = await getCredentials(guildId);
  if (!creds) return null;
  const cached = tokenCache.get(guildId);
  if (
    cached?.token &&
    cached.fetchedFor === creds.clientId &&
    cached.token.expiresAt > Date.now() + ABOUT_TO_EXPIRE_MS
  ) {
    return { token: cached.token.accessToken, clientId: creds.clientId };
  }
  const fresh = await fetchAppToken(creds.clientId, creds.clientSecret);
  tokenCache.set(guildId, { token: fresh, fetchedFor: creds.clientId });
  return { token: fresh.accessToken, clientId: creds.clientId };
}

export interface TwitchStream {
  id: string;
  user_login: string;
  user_name: string;
  game_name: string;
  title: string;
  viewer_count: number;
  thumbnail_url: string;
  started_at: string;
}

export async function fetchStream(
  guildId: string,
  username: string,
): Promise<TwitchStream | null> {
  const auth = await getToken(guildId);
  if (!auth) {
    log.info('Twitch credentials not set for guild', { guildId });
    return null;
  }
  const res = await request(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(username)}`,
    {
      headers: {
        authorization: `Bearer ${auth.token}`,
        'client-id': auth.clientId,
      },
    },
  );
  if (res.statusCode === 401) {
    // Token rejected — clear cache so next call refreshes.
    tokenCache.delete(guildId);
    return null;
  }
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    log.warn('Twitch /streams returned non-2xx', { status: res.statusCode, body: body.slice(0, 200) });
    return null;
  }
  const json = (await res.body.json()) as { data: TwitchStream[] };
  return json.data[0] ?? null;
}
