import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateWarningSchema,
  SnowflakeSchema,
  WarningListQuerySchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const ListParams = z.object({ guildId: SnowflakeSchema });
const ItemParams = z.object({ guildId: SnowflakeSchema, warningId: z.string().uuid() });

export const warningsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Create — called by the bot when a moderator runs /warn.
  app.post(
    '/guilds/:guildId/warnings',
    {
      preHandler: app.requireBot(),
      schema: {
        params: ListParams,
        body: CreateWarningSchema,
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId, moderatorId, reason } = req.body;

      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const warning = await app.prisma.warning.create({
        data: { guildId, userId, moderatorId, reason },
      });
      return {
        id: warning.id,
        guildId: warning.guildId,
        userId: warning.userId,
        moderatorId: warning.moderatorId,
        reason: warning.reason,
        createdAt: warning.createdAt.toISOString(),
      };
    },
  );

  // List — bot uses for `/warnings`. The web dashboard uses the parallel
  // session-authed endpoint under /admin/guilds/:guildId/warnings.
  app.get(
    '/guilds/:guildId/warnings',
    {
      preHandler: app.requireBot(),
      schema: {
        params: ListParams,
        querystring: WarningListQuerySchema,
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId, limit, cursor } = req.query;

      const where = userId ? { guildId, userId } : { guildId };
      const items = await app.prisma.warning.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const last = page[page.length - 1];
      return {
        warnings: page.map((w) => ({
          id: w.id,
          guildId: w.guildId,
          userId: w.userId,
          moderatorId: w.moderatorId,
          reason: w.reason,
          createdAt: w.createdAt.toISOString(),
        })),
        nextCursor: hasMore && last ? last.id : null,
      };
    },
  );

  // Delete a specific warning (used by web dashboard later, also bot for now).
  app.delete(
    '/guilds/:guildId/warnings/:warningId',
    {
      preHandler: app.requireBot(),
      schema: { params: ItemParams },
    },
    async (req, reply) => {
      const { guildId, warningId } = req.params;
      const result = await app.prisma.warning.deleteMany({
        where: { id: warningId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Warning not found.');
      return reply.code(204).send();
    },
  );
};
