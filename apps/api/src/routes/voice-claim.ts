import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  VoiceClaim as PrismaVoiceClaim,
  VoiceClaimConfig as PrismaVoiceClaimConfig,
  VoiceClaimableChannel as PrismaVoiceClaimableChannel,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateVoiceClaimSchema,
  CreateVoiceClaimableChannelSchema,
  SnowflakeSchema,
  UpdateVoiceClaimSchema,
  UpsertVoiceClaimConfigSchema,
  type VoiceClaimMode,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ChannelParams = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
});

function serializeConfig(guildId: string, cfg: PrismaVoiceClaimConfig | null) {
  return {
    guildId,
    enabled: cfg?.enabled ?? false,
    mode: (cfg?.mode ?? 'listed') as VoiceClaimMode,
  };
}

function serializeClaimable(row: PrismaVoiceClaimableChannel) {
  return {
    guildId: row.guildId,
    channelId: row.channelId,
  };
}

function serializeClaim(row: PrismaVoiceClaim) {
  return {
    guildId: row.guildId,
    channelId: row.channelId,
    ownerId: row.ownerId,
    claimedAt: row.claimedAt.toISOString(),
    lockedAt: row.lockedAt?.toISOString() ?? null,
  };
}

export const voiceClaimRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Config ──────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/voice-claim-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.voiceClaimConfig.findUnique({
        where: { guildId },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/voice-claim-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertVoiceClaimConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;

      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.mode !== undefined) update.mode = patch.mode;

      const cfg = await app.prisma.voiceClaimConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          mode: patch.mode ?? 'listed',
        },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  // ─── Claimable channels (allow-list) ─────────────────────────────────
  app.get(
    '/guilds/:guildId/voice-claimable',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const rows = await app.prisma.voiceClaimableChannel.findMany({
        where: { guildId: req.params.guildId },
      });
      return { channels: rows.map(serializeClaimable) };
    },
  );

  app.post(
    '/guilds/:guildId/voice-claimable',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateVoiceClaimableChannelSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const row = await app.prisma.voiceClaimableChannel.upsert({
        where: {
          guildId_channelId: { guildId, channelId: req.body.channelId },
        },
        update: {},
        create: { guildId, channelId: req.body.channelId },
      });
      return serializeClaimable(row);
    },
  );

  app.delete(
    '/guilds/:guildId/voice-claimable/:channelId',
    { preHandler: app.requireBot(), schema: { params: ChannelParams } },
    async (req, reply) => {
      const { guildId, channelId } = req.params;
      const result = await app.prisma.voiceClaimableChannel.deleteMany({
        where: { guildId, channelId },
      });
      if (result.count === 0) throw HttpError.notFound('Channel not claimable.');
      return reply.code(204).send();
    },
  );

  // ─── Active claims ───────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/voice-claims',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const rows = await app.prisma.voiceClaim.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { claimedAt: 'asc' },
      });
      return { claims: rows.map(serializeClaim) };
    },
  );

  app.post(
    '/guilds/:guildId/voice-claims',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateVoiceClaimSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const claim = await app.prisma.voiceClaim.upsert({
        where: {
          guildId_channelId: { guildId, channelId: req.body.channelId },
        },
        update: {
          ownerId: req.body.ownerId,
          claimedAt: new Date(),
          lockedAt: null,
        },
        create: {
          guildId,
          channelId: req.body.channelId,
          ownerId: req.body.ownerId,
        },
      });
      return serializeClaim(claim);
    },
  );

  app.delete(
    '/guilds/:guildId/voice-claims/:channelId',
    { preHandler: app.requireBot(), schema: { params: ChannelParams } },
    async (req, reply) => {
      const { guildId, channelId } = req.params;
      await app.prisma.voiceClaim
        .delete({
          where: { guildId_channelId: { guildId, channelId } },
        })
        .catch(() => {});
      return reply.code(204).send();
    },
  );

  app.patch(
    '/guilds/:guildId/voice-claims/:channelId',
    {
      preHandler: app.requireBot(),
      schema: { params: ChannelParams, body: UpdateVoiceClaimSchema },
    },
    async (req) => {
      const { guildId, channelId } = req.params;
      const data: { lockedAt?: Date | null } = {};
      if (req.body.lockedAt !== undefined) {
        data.lockedAt = req.body.lockedAt === null ? null : new Date(req.body.lockedAt);
      }
      const claim = await app.prisma.voiceClaim.update({
        where: { guildId_channelId: { guildId, channelId } },
        data,
      });
      return serializeClaim(claim);
    },
  );
};
