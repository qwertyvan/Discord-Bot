import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  CounterChannel as PrismaCounterChannel,
  VanityRole as PrismaVanityRole,
} from '@prisma/client';
import { z } from 'zod';
import {
  SnowflakeSchema,
  UpsertCounterChannelSchema,
  UpsertVanityRoleSchema,
  VanityRoleKindSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ChannelParams = z.object({ guildId: SnowflakeSchema, channelId: SnowflakeSchema });
const VanityParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });

function serializeCounter(c: PrismaCounterChannel) {
  return {
    guildId: c.guildId,
    channelId: c.channelId,
    type: c.type as 'members' | 'humans' | 'bots' | 'online' | 'boosts',
    template: c.template,
    updatedAt: c.updatedAt.toISOString(),
  };
}

function serializeVanityRole(v: PrismaVanityRole) {
  return {
    id: v.id,
    guildId: v.guildId,
    roleId: v.roleId,
    name: v.name,
    kind: v.kind as 'color' | 'badge',
    hexColor: v.hexColor,
    emoji: v.emoji,
    createdAt: v.createdAt.toISOString(),
  };
}

export const countersRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Counter channels ────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/counter-channels',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.counterChannel.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { updatedAt: 'desc' },
      });
      return { counters: items.map(serializeCounter) };
    },
  );

  app.put(
    '/guilds/:guildId/counter-channels',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertCounterChannelSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const item = await app.prisma.counterChannel.upsert({
        where: { channelId: req.body.channelId },
        update: {
          type: req.body.type,
          ...(req.body.template !== undefined ? { template: req.body.template } : {}),
        },
        create: {
          guildId,
          channelId: req.body.channelId,
          type: req.body.type,
          ...(req.body.template !== undefined ? { template: req.body.template } : {}),
        },
      });
      return serializeCounter(item);
    },
  );

  app.delete(
    '/guilds/:guildId/counter-channels/:channelId',
    { preHandler: app.requireBot(), schema: { params: ChannelParams } },
    async (req, reply) => {
      const result = await app.prisma.counterChannel.deleteMany({
        where: { guildId: req.params.guildId, channelId: req.params.channelId },
      });
      if (result.count === 0) throw HttpError.notFound('No counter on this channel.');
      return reply.code(204).send();
    },
  );

  // ─── Vanity roles ────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/vanity-roles',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({ kind: VanityRoleKindSchema.optional() }),
      },
    },
    async (req) => {
      const items = await app.prisma.vanityRole.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.kind ? { kind: req.query.kind } : {}),
        },
        orderBy: { createdAt: 'asc' },
      });
      return { vanityRoles: items.map(serializeVanityRole) };
    },
  );

  app.post(
    '/guilds/:guildId/vanity-roles',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertVanityRoleSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      // Replace any existing entry for the same role so add is idempotent.
      await app.prisma.vanityRole.deleteMany({ where: { guildId, roleId: req.body.roleId } });
      const item = await app.prisma.vanityRole.create({
        data: {
          guildId,
          roleId: req.body.roleId,
          name: req.body.name,
          kind: req.body.kind,
          ...(req.body.hexColor !== undefined ? { hexColor: req.body.hexColor } : {}),
          ...(req.body.emoji !== undefined ? { emoji: req.body.emoji } : {}),
        },
      });
      return serializeVanityRole(item);
    },
  );

  app.delete(
    '/guilds/:guildId/vanity-roles/:id',
    { preHandler: app.requireBot(), schema: { params: VanityParams } },
    async (req, reply) => {
      const result = await app.prisma.vanityRole.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Vanity role not found.');
      return reply.code(204).send();
    },
  );

  // Convenience: delete by Discord role id (used by the bot's /color admin remove).
  app.delete(
    '/guilds/:guildId/vanity-roles/by-role/:roleId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: z.object({ guildId: SnowflakeSchema, roleId: SnowflakeSchema }),
      },
    },
    async (req, reply) => {
      const result = await app.prisma.vanityRole.deleteMany({
        where: { guildId: req.params.guildId, roleId: req.params.roleId },
      });
      if (result.count === 0) throw HttpError.notFound('Vanity role not found.');
      return reply.code(204).send();
    },
  );
};
