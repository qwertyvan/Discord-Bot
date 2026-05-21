import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  CreateAutomodHitSchema,
  SnowflakeSchema,
  UpdateAutomodConfigSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const Params = z.object({ guildId: SnowflakeSchema });

function emptyConfigPayload(guildId: string) {
  return { guildId, enabled: false, exemptRoleIds: [], exemptChannelIds: [], rules: {} };
}

export const automodRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/automod-config',
    { preHandler: app.requireBot(), schema: { params: Params } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.automodConfig.findUnique({ where: { guildId } });
      if (!cfg) return emptyConfigPayload(guildId);
      return {
        guildId,
        enabled: cfg.enabled,
        exemptRoleIds: (cfg.exemptRoleIds as string[]) ?? [],
        exemptChannelIds: (cfg.exemptChannelIds as string[]) ?? [],
        rules: (cfg.rules as Record<string, unknown>) ?? {},
      };
    },
  );

  app.put(
    '/guilds/:guildId/automod-config',
    {
      preHandler: app.requireBot(),
      schema: { params: Params, body: UpdateAutomodConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;

      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.exemptRoleIds !== undefined) update.exemptRoleIds = patch.exemptRoleIds;
      if (patch.exemptChannelIds !== undefined) update.exemptChannelIds = patch.exemptChannelIds;
      if (patch.rules !== undefined) update.rules = patch.rules;

      const cfg = await app.prisma.automodConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          exemptRoleIds: patch.exemptRoleIds ?? [],
          exemptChannelIds: patch.exemptChannelIds ?? [],
          rules: (patch.rules ?? {}) as Prisma.InputJsonValue,
        },
      });
      return {
        guildId: cfg.guildId,
        enabled: cfg.enabled,
        exemptRoleIds: (cfg.exemptRoleIds as string[]) ?? [],
        exemptChannelIds: (cfg.exemptChannelIds as string[]) ?? [],
        rules: (cfg.rules as Record<string, unknown>) ?? {},
      };
    },
  );

  app.post(
    '/guilds/:guildId/automod-hits',
    {
      preHandler: app.requireBot(),
      schema: { params: Params, body: CreateAutomodHitSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const hit = await app.prisma.automodHit.create({
        data: {
          guildId,
          userId: req.body.userId,
          channelId: req.body.channelId ?? null,
          rule: req.body.rule,
          action: req.body.action,
          reason: req.body.reason,
          payload: (req.body.payload ?? {}) as Prisma.InputJsonValue,
        },
      });
      return {
        id: hit.id,
        guildId: hit.guildId,
        userId: hit.userId,
        channelId: hit.channelId,
        rule: hit.rule,
        action: hit.action,
        reason: hit.reason,
        payload: hit.payload as Record<string, unknown>,
        createdAt: hit.createdAt.toISOString(),
      };
    },
  );

  app.get(
    '/guilds/:guildId/automod-hits',
    {
      preHandler: app.requireBot(),
      schema: {
        params: Params,
        querystring: z.object({
          userId: SnowflakeSchema.optional(),
          rule: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId, rule, limit } = req.query;
      const hits = await app.prisma.automodHit.findMany({
        where: {
          guildId,
          ...(userId ? { userId } : {}),
          ...(rule ? { rule } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return {
        hits: hits.map((h) => ({
          id: h.id,
          guildId: h.guildId,
          userId: h.userId,
          channelId: h.channelId,
          rule: h.rule,
          action: h.action,
          reason: h.reason,
          payload: h.payload as Record<string, unknown>,
          createdAt: h.createdAt.toISOString(),
        })),
      };
    },
  );
};
