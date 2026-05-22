import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  VoiceHubChannel as PrismaVoiceHubChannel,
  VoiceSession as PrismaVoiceSession,
} from '@prisma/client';
import { z } from 'zod';
import {
  SnowflakeSchema,
  StartVoiceSessionSchema,
  UpsertVoiceHubSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const HubParams = z.object({ guildId: SnowflakeSchema, channelId: SnowflakeSchema });
const SessionParams = z.object({ guildId: SnowflakeSchema, sessionId: z.string().uuid() });

function serializeHub(h: PrismaVoiceHubChannel) {
  return {
    guildId: h.guildId,
    channelId: h.channelId,
    namePattern: h.namePattern,
    userLimit: h.userLimit,
    categoryId: h.categoryId,
    autoDelete: h.autoDelete,
    createdAt: h.createdAt.toISOString(),
  };
}

function serializeSession(s: PrismaVoiceSession) {
  return {
    id: s.id,
    guildId: s.guildId,
    userId: s.userId,
    channelId: s.channelId,
    joinedAt: s.joinedAt.toISOString(),
    leftAt: s.leftAt?.toISOString() ?? null,
  };
}

export const voiceRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Voice hubs ──────────────────────────────────────────────────────
  // Mirrors the sticky-message route pattern: bot-bearer-authenticated for
  // both bot-initiated mutations (slash command) and dashboard reads.
  app.get(
    '/guilds/:guildId/voice-hubs',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const hubs = await app.prisma.voiceHubChannel.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'asc' },
      });
      return { hubs: hubs.map(serializeHub) };
    },
  );

  app.post(
    '/guilds/:guildId/voice-hubs',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertVoiceHubSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const body = req.body;
      const hub = await app.prisma.voiceHubChannel.upsert({
        where: { channelId: body.channelId },
        update: {
          namePattern: body.namePattern,
          ...(body.userLimit !== undefined ? { userLimit: body.userLimit } : {}),
          ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
          ...(body.autoDelete !== undefined ? { autoDelete: body.autoDelete } : {}),
        },
        create: {
          guildId,
          channelId: body.channelId,
          namePattern: body.namePattern,
          userLimit: body.userLimit ?? null,
          categoryId: body.categoryId ?? null,
          autoDelete: body.autoDelete ?? true,
        },
      });
      return serializeHub(hub);
    },
  );

  app.delete(
    '/guilds/:guildId/voice-hubs/:channelId',
    {
      preHandler: app.requireBot(),
      schema: { params: HubParams },
    },
    async (req, reply) => {
      const { guildId, channelId } = req.params;
      const result = await app.prisma.voiceHubChannel.deleteMany({
        where: { guildId, channelId },
      });
      if (result.count === 0) throw HttpError.notFound('No hub on that channel.');
      return reply.code(204).send();
    },
  );

  // ─── Voice sessions (bot tracks join/leave) ──────────────────────────
  app.post(
    '/guilds/:guildId/voice-sessions/start',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: StartVoiceSessionSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      // Close any leftover open session for this user (defensive — handles
      // bot restarts where the leave was missed).
      await app.prisma.voiceSession.updateMany({
        where: { guildId, userId: req.body.userId, leftAt: null },
        data: { leftAt: new Date() },
      });

      const session = await app.prisma.voiceSession.create({
        data: {
          guildId,
          userId: req.body.userId,
          channelId: req.body.channelId,
        },
      });
      return serializeSession(session);
    },
  );

  app.post(
    '/guilds/:guildId/voice-sessions/:sessionId/end',
    {
      preHandler: app.requireBot(),
      schema: { params: SessionParams },
    },
    async (req) => {
      const { guildId, sessionId } = req.params;
      const session = await app.prisma.voiceSession.findFirst({
        where: { id: sessionId, guildId },
      });
      if (!session) throw HttpError.notFound('Session not found.');
      if (session.leftAt) return serializeSession(session);
      const updated = await app.prisma.voiceSession.update({
        where: { id: sessionId },
        data: { leftAt: new Date() },
      });
      return serializeSession(updated);
    },
  );

  // Scheduler reads currently-open sessions across all guilds to award
  // per-minute voice XP for populated channels.
  app.get(
    '/voice-sessions/active',
    { preHandler: app.requireBot() },
    async () => {
      const sessions = await app.prisma.voiceSession.findMany({
        where: { leftAt: null },
      });
      return { sessions: sessions.map(serializeSession) };
    },
  );
};
