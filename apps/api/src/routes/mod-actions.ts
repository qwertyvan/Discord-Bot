import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateModActionSchema,
  ModActionListQuerySchema,
  ModActionTypeSchema,
  SnowflakeSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { createModAction, serializeModAction } from '../services/mod-actions.js';
import { dispatchEvent } from '../webhook-dispatch.js';

const ListParams = z.object({ guildId: SnowflakeSchema });
const ItemParams = z.object({ guildId: SnowflakeSchema, actionId: z.string().uuid() });
const CaseParams = z.object({ guildId: SnowflakeSchema, caseNumber: z.coerce.number().int().positive() });

export const modActionsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Create — called by the bot whenever a moderator runs warn/kick/ban/etc.
  app.post(
    '/guilds/:guildId/mod-actions',
    {
      preHandler: app.requireBot(),
      schema: { params: ListParams, body: CreateModActionSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const result = await createModAction(app.prisma, guildId, req.body);
      const serialized = serializeModAction(result.action);
      dispatchEvent(app.prisma, guildId, 'modaction.created', { action: serialized }).catch(
        (err) => req.log.warn({ err }, 'dispatchEvent(modaction.created) failed'),
      );
      return {
        action: serialized,
        triggeredEscalation: result.triggeredEscalation,
      };
    },
  );

  // List
  app.get(
    '/guilds/:guildId/mod-actions',
    {
      preHandler: app.requireBot(),
      schema: { params: ListParams, querystring: ModActionListQuerySchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId, type, limit, cursor } = req.query;

      const where = {
        guildId,
        ...(userId ? { userId } : {}),
        ...(type ? { type } : {}),
      };
      const items = await app.prisma.modAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const last = page[page.length - 1];
      return {
        actions: page.map(serializeModAction),
        nextCursor: hasMore && last ? last.id : null,
      };
    },
  );

  // Look up by per-guild case number (humans use this).
  app.get(
    '/guilds/:guildId/mod-actions/case/:caseNumber',
    {
      preHandler: app.requireBot(),
      schema: { params: CaseParams },
    },
    async (req) => {
      const { guildId, caseNumber } = req.params;
      const action = await app.prisma.modAction.findUnique({
        where: { guildId_caseNumber: { guildId, caseNumber } },
      });
      if (!action) throw HttpError.notFound('Case not found.');
      return serializeModAction(action);
    },
  );

  // Delete (mark inactive).
  app.delete(
    '/guilds/:guildId/mod-actions/:actionId',
    {
      preHandler: app.requireBot(),
      schema: { params: ItemParams },
    },
    async (req, reply) => {
      const { guildId, actionId } = req.params;
      const result = await app.prisma.modAction.deleteMany({
        where: { id: actionId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Mod action not found.');
      return reply.code(204).send();
    },
  );

  // Unified history endpoint: mod actions + notes for a single user.
  app.get(
    '/guilds/:guildId/users/:userId/history',
    {
      preHandler: app.requireBot(),
      schema: {
        params: z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          types: z
            .preprocess(
              (v) => (typeof v === 'string' ? v.split(',') : v),
              z.array(ModActionTypeSchema).optional(),
            )
            .optional(),
        }),
      },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const { limit, types } = req.query;

      const [actions, notes] = await Promise.all([
        app.prisma.modAction.findMany({
          where: { guildId, userId, ...(types && types.length ? { type: { in: types } } : {}) },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        app.prisma.modNote.findMany({
          where: { guildId, userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      ]);

      return {
        actions: actions.map(serializeModAction),
        notes: notes.map((n) => ({
          id: n.id,
          guildId: n.guildId,
          userId: n.userId,
          moderatorId: n.moderatorId,
          content: n.content,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  );
};
