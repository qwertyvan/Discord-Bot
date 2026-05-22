import type { FastifyPluginAsync } from 'fastify';

/**
 * Health endpoints.
 *
 * `/health` returns a roll-up with detailed checks:
 *   - db: `SELECT 1` against Postgres, reports latency in ms.
 *   - bot: heartbeatAgeSeconds (from BotHeartbeat singleton) + ok flag
 *          (true when age < BOT_HEARTBEAT_FRESH_SECONDS, default 90s).
 *
 * `/health/db` remains for a lightweight DB-only probe.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  const freshSeconds = Number(process.env.BOT_HEARTBEAT_FRESH_SECONDS ?? 90);

  app.get('/health', async () => {
    const checks: {
      db: { ok: boolean; latencyMs?: number; error?: string };
      bot: { ok: boolean; heartbeatAgeSeconds: number | null };
    } = {
      db: { ok: false },
      bot: { ok: false, heartbeatAgeSeconds: null },
    };

    const t0 = Date.now();
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      checks.db = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      checks.db = { ok: false, error: (err as Error).message };
    }

    try {
      const hb = await app.prisma.botHeartbeat.findUnique({ where: { id: 1 } });
      if (hb) {
        const age = Math.round((Date.now() - hb.updatedAt.getTime()) / 1000);
        checks.bot = { ok: age < freshSeconds, heartbeatAgeSeconds: age };
      } else {
        checks.bot = { ok: false, heartbeatAgeSeconds: null };
      }
    } catch {
      checks.bot = { ok: false, heartbeatAgeSeconds: null };
    }

    const status = checks.db.ok && checks.bot.ok ? 'ok' : 'degraded';
    return { status, checks };
  });

  app.get('/health/db', async () => {
    await app.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'reachable' };
  });
};
