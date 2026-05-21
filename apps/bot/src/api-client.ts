import { request } from 'undici';
import { env } from './env.js';
import type {
  CreateWarningInput,
  Warning,
  WelcomeConfig,
  UpdateWelcomeConfigInput,
} from '@discord-bot/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function call<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(path, env.API_BASE_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await request(url, {
    method: opts.method ?? 'GET',
    headers: {
      authorization: `Bearer ${env.BOT_API_TOKEN}`,
      'content-type': 'application/json',
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });

  if (res.statusCode === 204) return undefined as T;

  const text = await res.body.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (res.statusCode >= 400) {
    const err = json as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiError(
      res.statusCode,
      err?.error?.code ?? 'unknown',
      err?.error?.message ?? `HTTP ${res.statusCode}`,
    );
  }
  return json as T;
}

export const api = {
  // Guild registry
  upsertGuild: (id: string, body: { name: string; iconUrl: string | null }) =>
    call<{ id: string; name: string; iconUrl: string | null; addedAt: string }>(
      `/guilds/${id}`,
      { method: 'PUT', body },
    ),
  deleteGuild: (id: string) => call<void>(`/guilds/${id}`, { method: 'DELETE' }),

  // Warnings
  createWarning: (guildId: string, body: CreateWarningInput) =>
    call<Warning>(`/guilds/${guildId}/warnings`, { method: 'POST', body }),
  listWarnings: (guildId: string, query?: { userId?: string; limit?: number }) =>
    call<{ warnings: Warning[]; nextCursor: string | null }>(
      `/guilds/${guildId}/warnings`,
      query ? { query } : {},
    ),

  // Welcome config
  getWelcomeConfig: (guildId: string) =>
    call<WelcomeConfig>(`/guilds/${guildId}/welcome`),
  updateWelcomeConfig: (guildId: string, body: UpdateWelcomeConfigInput) =>
    call<WelcomeConfig>(`/guilds/${guildId}/welcome`, { method: 'PUT', body }),
};
