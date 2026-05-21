import { cookies } from 'next/headers';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'db_session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

/**
 * Server-side fetch to the API that forwards the session cookie from the
 * incoming request. Use only from React Server Components / Route Handlers /
 * Server Actions.
 */
export async function serverFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  const url = new URL(path, API_BASE_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sessionCookie) {
    headers.cookie = `${sessionCookie.name}=${sessionCookie.value}`;
  }

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: 'no-store',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const err = json as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiError(
      res.status,
      err?.error?.code ?? 'unknown',
      err?.error?.message ?? `HTTP ${res.status}`,
    );
  }
  return json as T;
}

export const PUBLIC_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
