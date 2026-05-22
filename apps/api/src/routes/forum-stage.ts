import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  ForumAutoTag as PrismaForumAutoTag,
  StaleThreadPolicy as PrismaStaleThreadPolicy,
  StageScheduledEvent as PrismaStageScheduledEvent,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateStageEventSchema,
  SnowflakeSchema,
  StageEventStatusSchema,
  UpsertForumAutoTagSchema,
  UpsertStalePolicySchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ForumTagParams = z.object({ guildId: SnowflakeSchema, tagId: z.string().uuid() });
const StageEventParams = z.object({ guildId: SnowflakeSchema, eventId: z.string().uuid() });

function serializeForumTag(t: PrismaForumAutoTag) {
  return {
    id: t.id,
    guildId: t.guildId,
    channelId: t.channelId,
    keyword: t.keyword,
    tagId: t.tagId,
    createdAt: t.createdAt.toISOString(),
  };
}

function serializePolicy(guildId: string, p: PrismaStaleThreadPolicy | null) {
  return {
    guildId,
    enabled: p?.enabled ?? false,
    idleHours: p?.idleHours ?? 72,
    action: (p?.action ?? 'archive') as 'archive' | 'lock',
  };
}

function serializeStageEvent(e: PrismaStageScheduledEvent) {
  return {
    id: e.id,
    guildId: e.guildId,
    channelId: e.channelId,
    topic: e.topic,
    scheduledFor: e.scheduledFor.toISOString(),
    speakerIds: e.speakerIds,
    recapChannelId: e.recapChannelId,
    status: e.status as 'scheduled' | 'live' | 'ended' | 'cancelled',
    createdAt: e.createdAt.toISOString(),
  };
}

export const forumStageRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Forum auto-tags ─────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/forum-tags',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.forumAutoTag.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'asc' },
      });
      return { tags: items.map(serializeForumTag) };
    },
  );

  app.post(
    '/guilds/:guildId/forum-tags',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertForumAutoTagSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const item = await app.prisma.forumAutoTag.create({
        data: {
          guildId,
          channelId: req.body.channelId,
          keyword: req.body.keyword.toLowerCase(),
          tagId: req.body.tagId,
        },
      });
      return serializeForumTag(item);
    },
  );

  app.delete(
    '/guilds/:guildId/forum-tags/:tagId',
    { preHandler: app.requireBot(), schema: { params: ForumTagParams } },
    async (req, reply) => {
      const result = await app.prisma.forumAutoTag.deleteMany({
        where: { id: req.params.tagId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Forum tag rule not found.');
      return reply.code(204).send();
    },
  );

  // ─── Stale-thread policy ─────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/stale-thread-policy',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const p = await app.prisma.staleThreadPolicy.findUnique({
        where: { guildId: req.params.guildId },
      });
      return serializePolicy(req.params.guildId, p);
    },
  );

  app.put(
    '/guilds/:guildId/stale-thread-policy',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertStalePolicySchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update['enabled'] = patch.enabled;
      if (patch.idleHours !== undefined) update['idleHours'] = patch.idleHours;
      if (patch.action !== undefined) update['action'] = patch.action;
      const p = await app.prisma.staleThreadPolicy.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          idleHours: patch.idleHours ?? 72,
          action: patch.action ?? 'archive',
        },
      });
      return serializePolicy(guildId, p);
    },
  );

  // ─── Scheduled Stage events ──────────────────────────────────────────
  app.get(
    '/guilds/:guildId/stage-events',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          status: StageEventStatusSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const items = await app.prisma.stageScheduledEvent.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        orderBy: { scheduledFor: 'asc' },
        take: req.query.limit,
      });
      return { events: items.map(serializeStageEvent) };
    },
  );

  app.post(
    '/guilds/:guildId/stage-events',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateStageEventSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const e = await app.prisma.stageScheduledEvent.create({
        data: {
          guildId,
          channelId: req.body.channelId,
          topic: req.body.topic,
          scheduledFor: new Date(req.body.scheduledFor),
          speakerIds: req.body.speakerIds ?? [],
          recapChannelId: req.body.recapChannelId ?? null,
        },
      });
      return serializeStageEvent(e);
    },
  );

  app.get(
    '/guilds/:guildId/stage-events/:eventId',
    { preHandler: app.requireBot(), schema: { params: StageEventParams } },
    async (req) => {
      const e = await app.prisma.stageScheduledEvent.findFirst({
        where: { id: req.params.eventId, guildId: req.params.guildId },
      });
      if (!e) throw HttpError.notFound('Stage event not found.');
      return serializeStageEvent(e);
    },
  );

  app.patch(
    '/guilds/:guildId/stage-events/:eventId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: StageEventParams,
        body: z.object({ status: StageEventStatusSchema }),
      },
    },
    async (req) => {
      const updated = await app.prisma.stageScheduledEvent.update({
        where: { id: req.params.eventId },
        data: { status: req.body.status },
      });
      return serializeStageEvent(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/stage-events/:eventId',
    { preHandler: app.requireBot(), schema: { params: StageEventParams } },
    async (req, reply) => {
      const result = await app.prisma.stageScheduledEvent.deleteMany({
        where: { id: req.params.eventId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Stage event not found.');
      return reply.code(204).send();
    },
  );
};
