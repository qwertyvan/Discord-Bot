import type { FastifyPluginAsync } from 'fastify';
import { formatMetrics, incCounter } from '../util/metrics.js';

/**
 * GET /metrics → Prometheus exposition format.
 *
 * If METRICS_TOKEN env var is set, requires `Authorization: Bearer <token>`.
 * Otherwise the endpoint is open (typical for an in-cluster scrape target).
 *
 * Also installs a global `onResponse` hook so every HTTP response increments
 * `http_requests_total{method,route,status}`. The route label uses Fastify's
 * resolved `routeOptions.url` when present (e.g. `/guilds/:guildId/...`) so
 * cardinality stays bounded.
 */
export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onResponse', async (req, reply) => {
    try {
      const route = req.routeOptions?.url ?? req.url.split('?')[0] ?? 'unknown';
      // Skip /metrics itself to avoid self-amplification noise.
      if (route === '/metrics') return;
      incCounter('http_requests_total', {
        method: req.method,
        route,
        status: reply.statusCode,
      });
    } catch {
      // Never let metrics bookkeeping break a request.
    }
  });

  const token = process.env.METRICS_TOKEN;

  app.get('/metrics', async (req, reply) => {
    if (token) {
      const header = req.headers.authorization;
      const provided = header?.startsWith('Bearer ') ? header.slice(7) : null;
      if (provided !== token) {
        return reply.code(401).send('Unauthorized\n');
      }
    }
    reply.header('content-type', 'text/plain; version=0.0.4');
    return formatMetrics();
  });
};
