import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AutoReactionRule as PrismaAutoReactionRule } from '@prisma/client';
import { z } from 'zod';
import {
  CreateAutoReactionRuleSchema,
  SnowflakeSchema,
  UpdateAutoReactionRuleSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const MAX_RULES_PER_GUILD = 20;

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ItemParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });

function serialize(r: PrismaAutoReactionRule) {
  return {
    id: r.id,
    guildId: r.guildId,
    channelId: r.channelId,
    pattern: r.pattern,
    isRegex: r.isRegex,
    caseSensitive: r.caseSensitive,
    emojis: r.emojis,
    enabled: r.enabled,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

export const autoReactionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/auto-reactions',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.autoReactionRule.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'asc' },
      });
      return { rules: items.map(serialize) };
    },
  );

  // Cross-guild fetch of enabled rules for the bot's per-guild cache. We scope
  // by guildId in the URL so the per-guild caches don't have to filter.
  app.get(
    '/guilds/:guildId/auto-reactions/enabled',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.autoReactionRule.findMany({
        where: { guildId: req.params.guildId, enabled: true },
        orderBy: { createdAt: 'asc' },
      });
      return { rules: items.map(serialize) };
    },
  );

  app.post(
    '/guilds/:guildId/auto-reactions',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateAutoReactionRuleSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const count = await app.prisma.autoReactionRule.count({ where: { guildId } });
      if (count >= MAX_RULES_PER_GUILD) {
        throw HttpError.badRequest(
          `Auto-reaction rule cap reached (max ${MAX_RULES_PER_GUILD} per guild).`,
        );
      }
      if (req.body.emojis.length > 3) {
        throw HttpError.badRequest('Auto-reaction rules support at most 3 emojis.');
      }
      if (req.body.isRegex) {
        try {
          new RegExp(req.body.pattern);
        } catch {
          throw HttpError.badRequest('Invalid regular expression.');
        }
      }
      const item = await app.prisma.autoReactionRule.create({
        data: {
          guildId,
          channelId: req.body.channelId ?? null,
          pattern: req.body.pattern,
          isRegex: req.body.isRegex,
          caseSensitive: req.body.caseSensitive,
          emojis: req.body.emojis,
          enabled: req.body.enabled,
          createdBy: req.body.createdBy,
        },
      });
      return serialize(item);
    },
  );

  app.patch(
    '/guilds/:guildId/auto-reactions/:id',
    {
      preHandler: app.requireBot(),
      schema: { params: ItemParams, body: UpdateAutoReactionRuleSchema },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const existing = await app.prisma.autoReactionRule.findFirst({ where: { id, guildId } });
      if (!existing) throw HttpError.notFound('Auto-reaction rule not found.');
      if (req.body.emojis !== undefined && req.body.emojis.length > 3) {
        throw HttpError.badRequest('Auto-reaction rules support at most 3 emojis.');
      }
      const nextIsRegex = req.body.isRegex ?? existing.isRegex;
      const nextPattern = req.body.pattern ?? existing.pattern;
      if (nextIsRegex) {
        try {
          new RegExp(nextPattern);
        } catch {
          throw HttpError.badRequest('Invalid regular expression.');
        }
      }
      const update: Record<string, unknown> = {};
      if (req.body.channelId !== undefined) update['channelId'] = req.body.channelId;
      if (req.body.pattern !== undefined) update['pattern'] = req.body.pattern;
      if (req.body.isRegex !== undefined) update['isRegex'] = req.body.isRegex;
      if (req.body.caseSensitive !== undefined) update['caseSensitive'] = req.body.caseSensitive;
      if (req.body.emojis !== undefined) update['emojis'] = req.body.emojis;
      if (req.body.enabled !== undefined) update['enabled'] = req.body.enabled;
      const updated = await app.prisma.autoReactionRule.update({ where: { id }, data: update });
      return serialize(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/auto-reactions/:id',
    { preHandler: app.requireBot(), schema: { params: ItemParams } },
    async (req, reply) => {
      const result = await app.prisma.autoReactionRule.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Auto-reaction rule not found.');
      return reply.code(204).send();
    },
  );
};
