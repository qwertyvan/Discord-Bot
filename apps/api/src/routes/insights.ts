import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ActivityEventsBatchSchema,
  SnowflakeSchema,
  type InsightsSeriesPoint,
  type InsightsTopChannel,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { DiscordAuthError } from '../discord.js';
import { decryptTokenOrPlaintext } from '../crypto.js';
import { getManageableGuilds, invalidatePermissionsCache } from '../guild-permissions.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function withDiscordAuth<T>(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DiscordAuthError && req.user) {
      await app.prisma.session.delete({ where: { id: req.user.sessionId } }).catch(() => {});
      invalidatePermissionsCache(req.user.userId);
      app.clearSession(reply);
      throw HttpError.unauthorized('Discord session expired. Please sign in again.');
    }
    throw err;
  }
}

async function ensureGuildAccess(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  guildId: string,
): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const dbUser = await app.prisma.adminUser.findUnique({
    where: { discordId: req.user.userId },
  });
  if (!dbUser) throw HttpError.unauthorized();
  const manageable = await withDiscordAuth(app, req, reply, () =>
    getManageableGuilds(
      dbUser.discordId,
      decryptTokenOrPlaintext(dbUser.accessToken, app.config.TOKEN_ENCRYPTION_KEY),
    ),
  );
  if (!manageable.some((g) => g.id === guildId)) {
    throw HttpError.forbidden('You do not have Manage Server on this guild.');
  }
  const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) throw HttpError.notFound('Bot is not in that guild.');
}

export const insightsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Session-auth: dashboard summary ─────────────────────────────────
  app.get(
    '/guilds/:guildId/insights',
    {
      preHandler: app.requireSession(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          days: z.coerce.number().int().min(1).max(180).default(30),
        }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const { days } = req.query;

      const cutoff = startOfDayUTC(new Date(Date.now() - (days - 1) * 86_400_000));

      const [snapshots, channelRows] = await Promise.all([
        app.prisma.activitySnapshot.findMany({
          where: { guildId, day: { gte: cutoff } },
          orderBy: { day: 'asc' },
        }),
        app.prisma.channelDailyActivity.groupBy({
          by: ['channelId'],
          where: { guildId, day: { gte: cutoff } },
          _sum: { messages: true },
          orderBy: { _sum: { messages: 'desc' } },
          take: 10,
        }),
      ]);

      // Fill in zero rows for days with no activity so the chart has the
      // full window worth of points.
      const series: InsightsSeriesPoint[] = [];
      const byDay = new Map<string, (typeof snapshots)[number]>();
      for (const s of snapshots) byDay.set(dayKey(s.day), s);

      const totals = { joins: 0, leaves: 0, messages: 0, voiceMinutes: 0 };
      for (let i = 0; i < days; i++) {
        const dayDate = new Date(cutoff.getTime() + i * 86_400_000);
        const key = dayKey(dayDate);
        const row = byDay.get(key);
        const point: InsightsSeriesPoint = {
          day: key,
          joins: row?.joins ?? 0,
          leaves: row?.leaves ?? 0,
          messages: row?.messages ?? 0,
          voiceMinutes: row?.voiceMinutes ?? 0,
        };
        series.push(point);
        totals.joins += point.joins;
        totals.leaves += point.leaves;
        totals.messages += point.messages;
        totals.voiceMinutes += point.voiceMinutes;
      }

      const topChannels: InsightsTopChannel[] = channelRows.map((r) => ({
        channelId: r.channelId,
        messages: r._sum.messages ?? 0,
      }));

      return { guildId, days, series, totals, topChannels };
    },
  );

  // ─── Bot-auth: batched activity flush ────────────────────────────────
  app.post(
    '/guilds/:guildId/activity-events',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: ActivityEventsBatchSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const dayDate = new Date(`${req.body.day}T00:00:00Z`);
      const joinsDelta = req.body.joins ?? 0;
      const leavesDelta = req.body.leaves ?? 0;
      const messagesDelta = req.body.messages ?? 0;
      const voiceMinutesDelta = req.body.voiceMinutes ?? 0;
      const channelMessages = req.body.channelMessages ?? [];

      await app.prisma.$transaction([
        app.prisma.activitySnapshot.upsert({
          where: { guildId_day: { guildId, day: dayDate } },
          update: {
            joins: { increment: joinsDelta },
            leaves: { increment: leavesDelta },
            messages: { increment: messagesDelta },
            voiceMinutes: { increment: voiceMinutesDelta },
          },
          create: {
            guildId,
            day: dayDate,
            joins: joinsDelta,
            leaves: leavesDelta,
            messages: messagesDelta,
            voiceMinutes: voiceMinutesDelta,
          },
        }),
        ...channelMessages.map((entry) =>
          app.prisma.channelDailyActivity.upsert({
            where: {
              guildId_channelId_day: {
                guildId,
                channelId: entry.channelId,
                day: dayDate,
              },
            },
            update: { messages: { increment: entry.count } },
            create: {
              guildId,
              channelId: entry.channelId,
              day: dayDate,
              messages: entry.count,
            },
          }),
        ),
      ]);

      return { ok: true };
    },
  );
};
