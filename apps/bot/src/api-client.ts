import { request } from 'undici';
import { env } from './env.js';
import type {
  AuditEventType,
  CreateAuditEventInput,
  CreateModActionInput,
  CreateModNoteInput,
  LoggingConfig,
  ModAction,
  ModActionType,
  ModNote,
  WarningPolicy,
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

export interface CreateModActionResult {
  action: ModAction;
  triggeredEscalation: {
    action: 'TIMEOUT' | 'KICK' | 'BAN';
    durationMs?: number;
    reason: string;
  } | null;
}

export const api = {
  // Guild registry
  upsertGuild: (id: string, body: { name: string; iconUrl: string | null }) =>
    call<{ id: string; name: string; iconUrl: string | null; addedAt: string }>(
      `/guilds/${id}`,
      { method: 'PUT', body },
    ),
  deleteGuild: (id: string) => call<void>(`/guilds/${id}`, { method: 'DELETE' }),

  // Mod actions — unified entry point for warn/kick/ban/timeout/etc.
  createModAction: (guildId: string, body: CreateModActionInput) =>
    call<CreateModActionResult>(`/guilds/${guildId}/mod-actions`, { method: 'POST', body }),
  listModActions: (
    guildId: string,
    query?: { userId?: string; type?: ModActionType; limit?: number },
  ) =>
    call<{ actions: ModAction[]; nextCursor: string | null }>(
      `/guilds/${guildId}/mod-actions`,
      query ? { query } : {},
    ),
  getCase: (guildId: string, caseNumber: number) =>
    call<ModAction>(`/guilds/${guildId}/mod-actions/case/${caseNumber}`),
  deleteModAction: (guildId: string, actionId: string) =>
    call<void>(`/guilds/${guildId}/mod-actions/${actionId}`, { method: 'DELETE' }),

  // Mod notes
  createModNote: (guildId: string, body: CreateModNoteInput) =>
    call<ModNote>(`/guilds/${guildId}/mod-notes`, { method: 'POST', body }),
  listModNotes: (guildId: string, userId: string) =>
    call<{ notes: ModNote[] }>(`/guilds/${guildId}/users/${userId}/mod-notes`),
  deleteModNote: (guildId: string, noteId: string) =>
    call<void>(`/guilds/${guildId}/mod-notes/${noteId}`, { method: 'DELETE' }),

  // Combined history (mod actions + notes for one user)
  getUserHistory: (
    guildId: string,
    userId: string,
    query?: { limit?: number; types?: ModActionType[] },
  ) =>
    call<{ actions: ModAction[]; notes: ModNote[] }>(
      `/guilds/${guildId}/users/${userId}/history`,
      query
        ? {
            query: {
              ...(query.limit !== undefined ? { limit: query.limit } : {}),
              ...(query.types && query.types.length ? { types: query.types.join(',') } : {}),
            },
          }
        : {},
    ),

  // Warning policy
  getWarningPolicy: (guildId: string) =>
    call<WarningPolicy>(`/guilds/${guildId}/warning-policy`),

  // Audit events / logging
  createAuditEvent: (guildId: string, body: CreateAuditEventInput) =>
    call<{
      id: string;
      guildId: string;
      type: AuditEventType;
      userId: string | null;
      channelId: string | null;
      payload: Record<string, unknown>;
      createdAt: string;
    }>(`/guilds/${guildId}/audit-events`, { method: 'POST', body }),
  getLoggingConfig: (guildId: string) =>
    call<LoggingConfig>(`/guilds/${guildId}/logging-config`),

  // Welcome config
  getWelcomeConfig: (guildId: string) =>
    call<WelcomeConfig>(`/guilds/${guildId}/welcome`),
  updateWelcomeConfig: (guildId: string, body: UpdateWelcomeConfigInput) =>
    call<WelcomeConfig>(`/guilds/${guildId}/welcome`, { method: 'PUT', body }),
};
