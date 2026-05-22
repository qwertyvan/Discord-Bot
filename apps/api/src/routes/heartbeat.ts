import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { incCounter } from '../util/metrics.js';

// Only allow-listed counter names from the bot. This guards against the bot
// (or anything holding the bot token) blowing up cardinality on /metrics.
const BOT_METRIC_NAMES = new Set([
  'bot_commands_total',
  'scheduler_ticks_total',
]);

/**
 * POST /bot/heartbeat — bot-authed.
 *
 * The bot calls this every ~30s. We upsert a singleton row (id=1) in
 * BotHeartbeat; @updatedAt advances on every write so /health can compute
 * heartbeat age. Body is empty.
 *
 * POST /bot/metric — bot-authed.
 *
 * Bumps one of the allow-listed counters on the API's metrics registry.
 * Lets the bot record slash-command executions and scheduler ticks without
 * running its own /metrics endpoint.
 */
export const heartbeatRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/bot/heartbeat',
    {
      preHandler: app.requireBot(),
    },
    async () => {
      await app.prisma.botHeartbeat.upsert({
        where: { id: 1 },
        update: { updatedAt: new Date() },
        create: { id: 1 },
      });
      return { ok: true };
    },
  );

  app.post(
    '/bot/metric',
    {
      preHandler: app.requireBot(),
      schema: {
        body: z.object({
          name: z.string().min(1).max(64),
          labels: z.record(z.string().or(z.number())).optional(),
          by: z.number().int().positive().max(1_000_000).default(1),
        }),
      },
    },
    async (req) => {
      if (!BOT_METRIC_NAMES.has(req.body.name)) {
        return { ok: false, ignored: true as const };
      }
      incCounter(req.body.name, req.body.labels, req.body.by);
      return { ok: true };
    },
  );
};
