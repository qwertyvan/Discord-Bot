import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  BirthdayConfig as PrismaBirthdayConfig,
  Event as PrismaEvent,
  EventRsvp as PrismaEventRsvp,
  Prisma,
  ScheduledAnnouncement,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateEventSchema,
  CreateScheduledAnnouncementSchema,
  EventRsvpStatusSchema,
  SetUserBirthdaySchema,
  SnowflakeSchema,
  UpdateBirthdayConfigSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const AnnouncementParams = z.object({ guildId: SnowflakeSchema, announcementId: z.string().uuid() });
const UserBirthdayParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });
const EventParams = z.object({ guildId: SnowflakeSchema, eventId: z.string().uuid() });

function serializeAnnouncement(a: ScheduledAnnouncement) {
  return {
    id: a.id,
    guildId: a.guildId,
    channelId: a.channelId,
    content: a.content,
    embedJson: a.embedJson as Record<string, unknown> | null,
    runAt: a.runAt.toISOString(),
    repeatEvery: a.repeatEvery,
    lastRunAt: a.lastRunAt?.toISOString() ?? null,
    enabled: a.enabled,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
  };
}

function serializeEvent(e: PrismaEvent & { rsvps: PrismaEventRsvp[] }) {
  const counts = { yes: 0, maybe: 0, no: 0 };
  for (const r of e.rsvps) {
    if (r.status === 'yes' || r.status === 'maybe' || r.status === 'no') counts[r.status]++;
  }
  return {
    id: e.id,
    guildId: e.guildId,
    channelId: e.channelId,
    messageId: e.messageId,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    location: e.location,
    createdBy: e.createdBy,
    createdAt: e.createdAt.toISOString(),
    rsvps: e.rsvps.map((r) => ({
      eventId: r.eventId,
      userId: r.userId,
      status: r.status as 'yes' | 'maybe' | 'no',
      respondedAt: r.respondedAt.toISOString(),
    })),
    counts,
  };
}

function serializeBirthdayConfig(guildId: string, cfg: PrismaBirthdayConfig | null) {
  return {
    guildId,
    enabled: cfg?.enabled ?? false,
    channelId: cfg?.channelId ?? null,
    template: cfg?.template ?? null,
    announceHour: cfg?.announceHour ?? 12,
  };
}

function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const scheduledRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Scheduled announcements ──────────────────────────────────────────
  app.get(
    '/guilds/:guildId/announcements',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.scheduledAnnouncement.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { runAt: 'asc' },
      });
      return { announcements: items.map(serializeAnnouncement) };
    },
  );

  app.post(
    '/guilds/:guildId/announcements',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateScheduledAnnouncementSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const a = await app.prisma.scheduledAnnouncement.create({
        data: {
          guildId,
          channelId: req.body.channelId,
          content: req.body.content ?? null,
          embedJson: (req.body.embedJson ?? null) as Prisma.InputJsonValue,
          runAt: new Date(req.body.runAt),
          repeatEvery: req.body.repeatEvery ?? null,
          createdBy: req.body.createdBy,
        },
      });
      return serializeAnnouncement(a);
    },
  );

  app.delete(
    '/guilds/:guildId/announcements/:announcementId',
    { preHandler: app.requireBot(), schema: { params: AnnouncementParams } },
    async (req, reply) => {
      const result = await app.prisma.scheduledAnnouncement.deleteMany({
        where: { id: req.params.announcementId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Announcement not found.');
      return reply.code(204).send();
    },
  );

  // Bot fetches announcements due to fire. Caller is expected to follow up
  // with POST /announcements/:id/advance once the message has been queued.
  app.get(
    '/announcements/due',
    {
      preHandler: app.requireBot(),
      schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }) },
    },
    async (req) => {
      const items = await app.prisma.scheduledAnnouncement.findMany({
        where: { enabled: true, runAt: { lte: new Date() } },
        orderBy: { runAt: 'asc' },
        take: req.query.limit,
      });
      return { announcements: items.map(serializeAnnouncement) };
    },
  );

  app.post(
    '/announcements/:announcementId/advance',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ announcementId: z.string().uuid() }) },
    },
    async (req) => {
      const existing = await app.prisma.scheduledAnnouncement.findUnique({
        where: { id: req.params.announcementId },
      });
      if (!existing) throw HttpError.notFound('Announcement not found.');
      if (!existing.repeatEvery) {
        await app.prisma.scheduledAnnouncement.delete({ where: { id: existing.id } });
        return { deleted: true };
      }
      // Advance runAt to the next multiple of repeatEvery past now.
      const intervalMs = existing.repeatEvery * 1000;
      const elapsed = Date.now() - existing.runAt.getTime();
      const cycles = Math.max(1, Math.ceil(elapsed / intervalMs));
      const next = new Date(existing.runAt.getTime() + cycles * intervalMs);
      const updated = await app.prisma.scheduledAnnouncement.update({
        where: { id: existing.id },
        data: { lastRunAt: new Date(), runAt: next },
      });
      return serializeAnnouncement(updated);
    },
  );

  // ─── Birthday config + entries ────────────────────────────────────────
  app.get(
    '/guilds/:guildId/birthday-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const cfg = await app.prisma.birthdayConfig.findUnique({ where: { guildId: req.params.guildId } });
      return serializeBirthdayConfig(req.params.guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/birthday-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpdateBirthdayConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      for (const k of ['enabled', 'channelId', 'template', 'announceHour'] as const) {
        const v = (patch as Record<string, unknown>)[k];
        if (v !== undefined) update[k] = v;
      }
      const cfg = await app.prisma.birthdayConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          template: patch.template ?? null,
          announceHour: patch.announceHour ?? 12,
        },
      });
      return serializeBirthdayConfig(guildId, cfg);
    },
  );

  app.get(
    '/guilds/:guildId/users/:userId/birthday',
    { preHandler: app.requireBot(), schema: { params: UserBirthdayParams } },
    async (req) => {
      const row = await app.prisma.userBirthday.findUnique({
        where: { guildId_userId: req.params },
      });
      return row
        ? {
            guildId: row.guildId,
            userId: row.userId,
            month: row.month,
            day: row.day,
            year: row.year,
          }
        : null;
    },
  );

  app.put(
    '/guilds/:guildId/users/:userId/birthday',
    {
      preHandler: app.requireBot(),
      schema: { params: UserBirthdayParams, body: SetUserBirthdaySchema },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const row = await app.prisma.userBirthday.upsert({
        where: { guildId_userId: { guildId, userId } },
        update: { month: req.body.month, day: req.body.day, year: req.body.year ?? null },
        create: {
          guildId,
          userId,
          month: req.body.month,
          day: req.body.day,
          year: req.body.year ?? null,
        },
      });
      return { guildId, userId, month: row.month, day: row.day, year: row.year };
    },
  );

  app.delete(
    '/guilds/:guildId/users/:userId/birthday',
    { preHandler: app.requireBot(), schema: { params: UserBirthdayParams } },
    async (req, reply) => {
      await app.prisma.userBirthday.deleteMany({
        where: { guildId: req.params.guildId, userId: req.params.userId },
      });
      return reply.code(204).send();
    },
  );

  // The bot calls this hourly. If the configured announce-hour matches the
  // current hour AND we haven't already announced today, returns today's
  // birthdays and marks the date so we don't double-fire.
  app.post(
    '/guilds/:guildId/birthdays/poll',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.birthdayConfig.findUnique({ where: { guildId } });
      if (!cfg?.enabled || !cfg.channelId || !cfg.template) {
        return { fired: false, birthdays: [] };
      }
      const now = new Date();
      if (now.getUTCHours() !== cfg.announceHour) return { fired: false, birthdays: [] };
      const today = todayUTC();
      if (cfg.lastAnnouncedDate && cfg.lastAnnouncedDate.getTime() >= today.getTime()) {
        return { fired: false, birthdays: [] };
      }
      const list = await app.prisma.userBirthday.findMany({
        where: { guildId, month: now.getUTCMonth() + 1, day: now.getUTCDate() },
      });
      await app.prisma.birthdayConfig.update({
        where: { guildId },
        data: { lastAnnouncedDate: today },
      });
      return {
        fired: true,
        channelId: cfg.channelId,
        template: cfg.template,
        birthdays: list.map((b) => ({
          userId: b.userId,
          month: b.month,
          day: b.day,
          year: b.year,
        })),
      };
    },
  );

  // ─── Events ───────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/events',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          upcoming: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(25),
        }),
      },
    },
    async (req) => {
      const items = await app.prisma.event.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.upcoming ? { startsAt: { gte: new Date() } } : {}),
        },
        include: { rsvps: true },
        orderBy: { startsAt: 'asc' },
        take: req.query.limit,
      });
      return { events: items.map(serializeEvent) };
    },
  );

  app.post(
    '/guilds/:guildId/events',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateEventSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const e = await app.prisma.event.create({
        data: {
          guildId,
          channelId: req.body.channelId,
          title: req.body.title,
          description: req.body.description ?? null,
          startsAt: new Date(req.body.startsAt),
          endsAt: req.body.endsAt ? new Date(req.body.endsAt) : null,
          location: req.body.location ?? null,
          createdBy: req.body.createdBy,
        },
        include: { rsvps: true },
      });
      return serializeEvent(e);
    },
  );

  app.get(
    '/guilds/:guildId/events/:eventId',
    { preHandler: app.requireBot(), schema: { params: EventParams } },
    async (req) => {
      const e = await app.prisma.event.findFirst({
        where: { id: req.params.eventId, guildId: req.params.guildId },
        include: { rsvps: true },
      });
      if (!e) throw HttpError.notFound('Event not found.');
      return serializeEvent(e);
    },
  );

  app.patch(
    '/guilds/:guildId/events/:eventId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: EventParams,
        body: z.object({ messageId: SnowflakeSchema.nullable().optional() }),
      },
    },
    async (req) => {
      const updated = await app.prisma.event.update({
        where: { id: req.params.eventId },
        data: { ...(req.body.messageId !== undefined ? { messageId: req.body.messageId } : {}) },
        include: { rsvps: true },
      });
      return serializeEvent(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/events/:eventId',
    { preHandler: app.requireBot(), schema: { params: EventParams } },
    async (req, reply) => {
      const result = await app.prisma.event.deleteMany({
        where: { id: req.params.eventId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Event not found.');
      return reply.code(204).send();
    },
  );

  app.post(
    '/guilds/:guildId/events/:eventId/rsvp',
    {
      preHandler: app.requireBot(),
      schema: {
        params: EventParams,
        body: z.object({ userId: SnowflakeSchema, status: EventRsvpStatusSchema }),
      },
    },
    async (req) => {
      const { eventId } = req.params;
      const { userId, status } = req.body;
      await app.prisma.eventRsvp.upsert({
        where: { eventId_userId: { eventId, userId } },
        update: { status, respondedAt: new Date() },
        create: { eventId, userId, status },
      });
      const e = await app.prisma.event.findUniqueOrThrow({
        where: { id: eventId },
        include: { rsvps: true },
      });
      return serializeEvent(e);
    },
  );
};
