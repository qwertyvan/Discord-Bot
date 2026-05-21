import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { SnowflakeSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const statsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Bot flushes batched message-activity counts here. Body is a list of
  // (channelId, hour, count) entries scoped to a single guild.
  app.post(
    '/guilds/:guildId/message-activity',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        body: z.object({
          entries: z
            .array(
              z.object({
                channelId: SnowflakeSchema,
                // ISO date (YYYY-MM-DD).
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                hour: z.number().int().min(0).max(23),
                count: z.number().int().min(1).max(100_000),
              }),
            )
            .min(1)
            .max(500),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      // Single transaction with batched upserts.
      await app.prisma.$transaction(
        req.body.entries.map((e) =>
          app.prisma.messageActivity.upsert({
            where: {
              guildId_channelId_date_hour: {
                guildId,
                channelId: e.channelId,
                date: new Date(`${e.date}T00:00:00Z`),
                hour: e.hour,
              },
            },
            update: { count: { increment: e.count } },
            create: {
              guildId,
              channelId: e.channelId,
              date: new Date(`${e.date}T00:00:00Z`),
              hour: e.hour,
              count: e.count,
            },
          }),
        ),
      );
      return { ok: true, count: req.body.entries.length };
    },
  );

  // Stats endpoints below are admin-only — exposed under /admin/* in
  // routes/admin/guilds.ts. The bot doesn't need them.
};

/**
 * Helpers used by admin routes.
 */
export async function modActionsTrend(
  prisma: Prisma.TransactionClient | PrismaClient,
  guildId: string,
  days: number,
): Promise<Array<{ date: string; type: string; count: number }>> {
  const cutoff = startOfDayUTC(new Date(Date.now() - (days - 1) * 86_400_000));
  const rows = (await prisma.$queryRaw`
    SELECT
      to_char(date_trunc('day', "createdAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      "type",
      count(*)::int AS count
    FROM "ModAction"
    WHERE "guildId" = ${guildId} AND "createdAt" >= ${cutoff}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `) as Array<{ date: string; type: string; count: number }>;
  return rows;
}

export async function memberGrowth(
  prisma: PrismaClient,
  guildId: string,
  days: number,
): Promise<Array<{ date: string; joins: number; leaves: number }>> {
  const cutoff = startOfDayUTC(new Date(Date.now() - (days - 1) * 86_400_000));
  const rows = (await prisma.$queryRaw`
    SELECT
      to_char(date_trunc('day', "createdAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      sum(CASE WHEN "type" = 'MEMBER_JOIN' THEN 1 ELSE 0 END)::int AS joins,
      sum(CASE WHEN "type" = 'MEMBER_LEAVE' THEN 1 ELSE 0 END)::int AS leaves
    FROM "AuditEvent"
    WHERE "guildId" = ${guildId}
      AND "createdAt" >= ${cutoff}
      AND "type" IN ('MEMBER_JOIN', 'MEMBER_LEAVE')
    GROUP BY 1
    ORDER BY 1 ASC
  `) as Array<{ date: string; joins: number; leaves: number }>;
  return rows;
}

export async function topTargets(
  prisma: PrismaClient,
  guildId: string,
  days: number,
  limit: number,
): Promise<Array<{ userId: string; count: number }>> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const top = await prisma.modAction.groupBy({
    by: ['userId'],
    where: { guildId, createdAt: { gte: cutoff } },
    _count: { userId: true },
    orderBy: { _count: { userId: 'desc' } },
    take: limit,
  });
  return top.map((row) => ({ userId: row.userId, count: row._count.userId }));
}

export async function channelHeatmap(
  prisma: PrismaClient,
  guildId: string,
  days: number,
): Promise<Array<{ channelId: string; hour: number; count: number }>> {
  const cutoff = startOfDayUTC(new Date(Date.now() - (days - 1) * 86_400_000));
  const rows = await prisma.messageActivity.groupBy({
    by: ['channelId', 'hour'],
    where: { guildId, date: { gte: cutoff } },
    _sum: { count: true },
    orderBy: { channelId: 'asc' },
  });
  return rows.map((r) => ({
    channelId: r.channelId,
    hour: r.hour,
    count: r._sum.count ?? 0,
  }));
}

export { dateKey };
