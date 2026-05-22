import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FeedSubscription } from '@prisma/client';
import { z } from 'zod';
import {
  CreateFeedSubscriptionSchema,
  FeedKindSchema,
  SnowflakeSchema,
  UpdateFeedLastItemSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ItemParams = z.object({ guildId: SnowflakeSchema, feedId: z.string().uuid() });

function serializeFeed(s: FeedSubscription) {
  return {
    id: s.id,
    guildId: s.guildId,
    kind: s.kind as 'youtube' | 'reddit' | 'bluesky' | 'mastodon',
    identifier: s.identifier,
    channelId: s.channelId,
    template: s.template,
    lastItemId: s.lastItemId,
    enabled: s.enabled,
    createdAt: s.createdAt.toISOString(),
  };
}

export const feedsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/feeds',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({ kind: FeedKindSchema.optional() }),
      },
    },
    async (req) => {
      const subs = await app.prisma.feedSubscription.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.kind ? { kind: req.query.kind } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      return { feeds: subs.map(serializeFeed) };
    },
  );

  app.post(
    '/guilds/:guildId/feeds',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateFeedSubscriptionSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const sub = await app.prisma.feedSubscription.create({
        data: {
          guildId,
          kind: req.body.kind,
          identifier: req.body.identifier,
          channelId: req.body.channelId,
          template: req.body.template ?? null,
        },
      });
      return serializeFeed(sub);
    },
  );

  app.delete(
    '/guilds/:guildId/feeds/:feedId',
    { preHandler: app.requireBot(), schema: { params: ItemParams } },
    async (req, reply) => {
      const result = await app.prisma.feedSubscription.deleteMany({
        where: { id: req.params.feedId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Feed not found.');
      return reply.code(204).send();
    },
  );

  // Bot-side state advance: update lastItemId after queueing new posts.
  app.patch(
    '/guilds/:guildId/feeds/:feedId/lastItem',
    {
      preHandler: app.requireBot(),
      schema: { params: ItemParams, body: UpdateFeedLastItemSchema },
    },
    async (req) => {
      const existing = await app.prisma.feedSubscription.findFirst({
        where: { id: req.params.feedId, guildId: req.params.guildId },
      });
      if (!existing) throw HttpError.notFound('Feed not found.');
      const updated = await app.prisma.feedSubscription.update({
        where: { id: req.params.feedId },
        data: { lastItemId: req.body.lastItemId },
      });
      return serializeFeed(updated);
    },
  );

  // Cross-guild list of enabled feeds — used by the bot scheduler tick.
  app.get(
    '/feeds/enabled',
    {
      preHandler: app.requireBot(),
      schema: {
        querystring: z.object({
          kind: FeedKindSchema.optional(),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        }),
      },
    },
    async (req) => {
      const subs = await app.prisma.feedSubscription.findMany({
        where: {
          enabled: true,
          ...(req.query.kind ? { kind: req.query.kind } : {}),
        },
        take: req.query.limit,
        orderBy: { createdAt: 'asc' },
      });
      return { feeds: subs.map(serializeFeed) };
    },
  );
};
