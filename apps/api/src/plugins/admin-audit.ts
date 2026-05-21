import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';

const TRACKED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records every session-authed mutating call under /admin/* to the
 * AdminAction table. Reads (GET) are skipped. The body is summarized — top-
 * level keys are kept but their string values are truncated, and obvious
 * secret-shaped keys are redacted entirely.
 */
const SENSITIVE_KEY = /token|secret|password|key/i;

function summarizeBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    if (typeof v === 'string') out[k] = v.length > 80 ? v.slice(0, 80) + '…' : v;
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = `[${v.length} items]`;
    else out[k] = '[object]';
  }
  return out;
}

function guildIdFromUrl(url: string): string | null {
  const match = /\/admin\/guilds\/(\d{17,20})/.exec(url);
  return match ? match[1]! : null;
}

export default fp(async (app) => {
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!TRACKED_METHODS.has(req.method)) return;
    if (!req.url.startsWith('/admin/')) return;
    if (!req.user) return;
    // Skip failures with 5xx; record 2xx and 4xx (4xx is still useful audit).
    if (reply.statusCode >= 500) return;

    try {
      await app.prisma.adminAction.create({
        data: {
          guildId: guildIdFromUrl(req.url),
          userId: req.user.userId,
          method: req.method,
          path: req.url.slice(0, 256),
          summary: summarizeBody(req.body) as Prisma.InputJsonValue,
          status: reply.statusCode,
        },
      });
    } catch (err) {
      req.log.warn({ err }, 'Failed to record admin action');
    }
  });
});
