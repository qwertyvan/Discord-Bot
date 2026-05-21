import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Per-IP rate-limiting baseline:
 *   - `/auth/*` and `/webhooks/in/*` — 30 req/min (public-ish surface)
 *   - mutating `/admin/*` — 60 req/min (logged-in dashboard actions)
 *   - everything else — 600 req/min (generous; bot-authed traffic dominates)
 *
 * The global default is intentionally large so bot-bearer routes
 * (`requireBot()`) are effectively unlimited; they're single-process
 * internal traffic and rate-limiting them stalls legitimate use.
 */
export default fp(async (app) => {
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
  });

  app.addHook('onRoute', (route) => {
    const existing = (route.config ?? {}) as Record<string, unknown>;
    if (existing.rateLimit !== undefined) return;

    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const isMutation = methods.some((m) => MUTATING_METHODS.has(m));
    const url = route.url;

    if (url.startsWith('/auth/') || url.startsWith('/webhooks/in')) {
      route.config = { ...existing, rateLimit: { max: 30, timeWindow: '1 minute' } };
    } else if (url.startsWith('/admin/') && isMutation) {
      route.config = { ...existing, rateLimit: { max: 60, timeWindow: '1 minute' } };
    }
    // else: inherit global 600/min default
  });
});
