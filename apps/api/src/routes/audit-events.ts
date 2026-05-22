import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  AuditEventTypeSchema,
  CreateAuditEventSchema,
  SnowflakeSchema,
  UpdateLoggingConfigSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { dispatchEvent } from '../webhook-dispatch.js';

const Params = z.object({ guildId: SnowflakeSchema });

export const auditEventsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Single-event ingestion. Batched ingestion can be added if it becomes hot.
  app.post(
    '/guilds/:guildId/audit-events',
    {
      preHandler: app.requireBot(),
      schema: { params: Params, body: CreateAuditEventSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const event = await app.prisma.auditEvent.create({
        data: {
          guildId,
          type: req.body.type,
          userId: req.body.userId ?? null,
          channelId: req.body.channelId ?? null,
          payload: (req.body.payload ?? {}) as Prisma.InputJsonValue,
        },
      });
      const serialized = {
        id: event.id,
        guildId: event.guildId,
        type: event.type,
        userId: event.userId,
        channelId: event.channelId,
        payload: event.payload as Record<string, unknown>,
        createdAt: event.createdAt.toISOString(),
      };
      // Forward member-lifecycle events to subscribed outbound webhooks. The
      // bot's audit dispatcher already fires this endpoint for join/leave, so
      // we get full coverage for free.
      if (req.body.type === 'MEMBER_JOIN') {
        dispatchEvent(app.prisma, guildId, 'member.join', { event: serialized }).catch((err) =>
          req.log.warn({ err }, 'dispatchEvent(member.join) failed'),
        );
      } else if (req.body.type === 'MEMBER_LEAVE') {
        dispatchEvent(app.prisma, guildId, 'member.leave', { event: serialized }).catch((err) =>
          req.log.warn({ err }, 'dispatchEvent(member.leave) failed'),
        );
      }
      return serialized;
    },
  );

  // Logging config: the bot reads this on every event to decide whether to
  // record the event and/or post it to the configured channel.
  app.get(
    '/guilds/:guildId/logging-config',
    {
      preHandler: app.requireBot(),
      schema: { params: Params },
    },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.loggingConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: cfg?.enabled ?? false,
        channelId: cfg?.channelId ?? null,
        events: (cfg?.events as Record<string, boolean>) ?? {},
      };
    },
  );

  app.put(
    '/guilds/:guildId/logging-config',
    {
      preHandler: app.requireBot(),
      schema: { params: Params, body: UpdateLoggingConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;

      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.events !== undefined) update.events = patch.events;

      const cfg = await app.prisma.loggingConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          events: patch.events ?? {},
        },
      });
      return {
        guildId: cfg.guildId,
        enabled: cfg.enabled,
        channelId: cfg.channelId,
        events: (cfg.events as Record<string, boolean>) ?? {},
      };
    },
  );

  // Optional ad-hoc lookup for the dashboard (also exposed under /admin/*).
  app.get(
    '/guilds/:guildId/audit-events',
    {
      preHandler: app.requireBot(),
      schema: {
        params: Params,
        querystring: z.object({
          type: AuditEventTypeSchema.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const { type, limit } = req.query;
      const events = await app.prisma.auditEvent.findMany({
        where: { guildId, ...(type ? { type } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return {
        events: events.map((e) => ({
          id: e.id,
          guildId: e.guildId,
          type: e.type,
          userId: e.userId,
          channelId: e.channelId,
          payload: e.payload as Record<string, unknown>,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },
  );
};
