import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AutoResponse } from '@prisma/client';
import { z } from 'zod';
import {
  CreateAutoResponseSchema,
  SnowflakeSchema,
  UpdateAutoResponseSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ItemParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });

function serialize(a: AutoResponse) {
  return {
    id: a.id,
    guildId: a.guildId,
    trigger: a.trigger,
    matchType: a.matchType as 'contains' | 'word' | 'exact',
    caseSensitive: a.caseSensitive,
    response: a.response,
    enabled: a.enabled,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export const autoResponsesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/auto-responses',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.autoResponse.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'desc' },
      });
      return { autoResponses: items.map(serialize) };
    },
  );

  app.post(
    '/guilds/:guildId/auto-responses',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateAutoResponseSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const item = await app.prisma.autoResponse.create({
        data: {
          guildId,
          trigger: req.body.trigger,
          matchType: req.body.matchType,
          caseSensitive: req.body.caseSensitive,
          response: req.body.response,
          enabled: req.body.enabled,
        },
      });
      return serialize(item);
    },
  );

  app.patch(
    '/guilds/:guildId/auto-responses/:id',
    {
      preHandler: app.requireBot(),
      schema: { params: ItemParams, body: UpdateAutoResponseSchema },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const existing = await app.prisma.autoResponse.findFirst({ where: { id, guildId } });
      if (!existing) throw HttpError.notFound('Auto-response not found.');
      const update: Record<string, unknown> = {};
      if (req.body.trigger !== undefined) update.trigger = req.body.trigger;
      if (req.body.matchType !== undefined) update.matchType = req.body.matchType;
      if (req.body.caseSensitive !== undefined) update.caseSensitive = req.body.caseSensitive;
      if (req.body.response !== undefined) update.response = req.body.response;
      if (req.body.enabled !== undefined) update.enabled = req.body.enabled;
      const updated = await app.prisma.autoResponse.update({ where: { id }, data: update });
      return serialize(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/auto-responses/:id',
    { preHandler: app.requireBot(), schema: { params: ItemParams } },
    async (req, reply) => {
      const result = await app.prisma.autoResponse.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Auto-response not found.');
      return reply.code(204).send();
    },
  );
};
