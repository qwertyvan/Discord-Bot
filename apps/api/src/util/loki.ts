/**
 * Best-effort Loki log shipper.
 *
 * If `LOG_LOKI_URL` is set, attach a pino write hook (via a wrapped destination)
 * that buffers log lines in memory and POSTs them to Loki's /loki/api/v1/push
 * endpoint every 5 seconds in batched form. Failures are swallowed — log
 * delivery never breaks the request path.
 *
 * Loki push payload shape:
 *   { streams: [{ stream: { app, level }, values: [["<ns>", "<line>"], ...] }] }
 */

import type { FastifyServerOptions } from 'fastify';

const BATCH_INTERVAL_MS = 5_000;
const MAX_BATCH = 1000;

interface Entry {
  ns: string; // nanoseconds since epoch as string
  line: string;
  level: string;
}

let buffer: Entry[] = [];
let timer: NodeJS.Timeout | null = null;
let pushUrl: string | null = null;
let appLabel = 'discord-bot-api';

async function flush(): Promise<void> {
  if (!pushUrl || buffer.length === 0) return;
  const batch = buffer.slice(0, MAX_BATCH);
  buffer = buffer.slice(batch.length);

  // Group by level for stream labels.
  const byLevel = new Map<string, Array<[string, string]>>();
  for (const e of batch) {
    const arr = byLevel.get(e.level) ?? [];
    arr.push([e.ns, e.line]);
    byLevel.set(e.level, arr);
  }
  const streams = Array.from(byLevel.entries()).map(([level, values]) => ({
    stream: { app: appLabel, level },
    values,
  }));

  try {
    await fetch(pushUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streams }),
    }).catch(() => undefined);
  } catch {
    // ignore — defensive
  }
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    flush().catch(() => undefined);
  }, BATCH_INTERVAL_MS);
  // Don't keep the process alive on the timer alone.
  if (typeof timer.unref === 'function') timer.unref();
}

function pinoLevelLabel(num: number): string {
  if (num >= 60) return 'fatal';
  if (num >= 50) return 'error';
  if (num >= 40) return 'warn';
  if (num >= 30) return 'info';
  if (num >= 20) return 'debug';
  return 'trace';
}

/**
 * Returns a pino stream wrapper if LOG_LOKI_URL is set, else null. The wrapper
 * forwards each line to stdout (so local logs still appear) and enqueues a
 * copy for Loki.
 */
export function buildLokiStream(): NodeJS.WritableStream | null {
  const url = process.env.LOG_LOKI_URL;
  if (!url) return null;
  pushUrl = url.replace(/\/$/, '');
  if (!pushUrl.endsWith('/loki/api/v1/push')) {
    pushUrl = `${pushUrl}/loki/api/v1/push`;
  }
  if (process.env.LOG_LOKI_APP) appLabel = process.env.LOG_LOKI_APP;
  ensureTimer();

  const stream: NodeJS.WritableStream = {
    write(chunk: string | Buffer): boolean {
      const line = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      process.stdout.write(line);
      try {
        const trimmed = line.trim();
        if (!trimmed) return true;
        // Pino JSON line: { level: number, time: ms, msg, ... }.
        let level = 'info';
        let timeMs = Date.now();
        if (trimmed.startsWith('{')) {
          const parsed = JSON.parse(trimmed) as { level?: number; time?: number };
          if (typeof parsed.level === 'number') level = pinoLevelLabel(parsed.level);
          if (typeof parsed.time === 'number') timeMs = parsed.time;
        }
        const ns = `${timeMs}000000`;
        if (buffer.length < MAX_BATCH * 4) {
          buffer.push({ ns, line: trimmed, level });
        }
      } catch {
        // ignore parse errors
      }
      return true;
    },
    end(): void {
      flush().catch(() => undefined);
    },
  } as unknown as NodeJS.WritableStream;
  return stream;
}

/**
 * Convenience: returns the `stream` portion of a pino options object when Loki
 * is configured, or undefined.
 */
export function lokiPinoOption(): FastifyServerOptions['logger'] | undefined {
  const stream = buildLokiStream();
  if (!stream) return undefined;
  return { level: process.env.LOG_LEVEL ?? 'info', stream } as FastifyServerOptions['logger'];
}
