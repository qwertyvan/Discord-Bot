import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  StickyMessage as PrismaStickyMessage,
  Suggestion as PrismaSuggestion,
  SuggestionVote as PrismaSuggestionVote,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateSuggestionSchema,
  EmbedBuilderSchema,
  ReviewSuggestionSchema,
  SnowflakeSchema,
  UpsertStickyMessageSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ChannelParams = z.object({ guildId: SnowflakeSchema, channelId: SnowflakeSchema });
const SuggestionParams = z.object({ guildId: SnowflakeSchema, suggestionId: z.string().uuid() });

function serializeSticky(s: PrismaStickyMessage) {
  return {
    guildId: s.guildId,
    channelId: s.channelId,
    content: s.content,
    lastMessageId: s.lastMessageId,
    throttleMessages: s.throttleMessages,
    enabled: s.enabled,
  };
}

function serializeSuggestion(s: PrismaSuggestion & { votes: PrismaSuggestionVote[] }) {
  const up = s.votes.filter((v) => v.vote === 1).length;
  const down = s.votes.filter((v) => v.vote === -1).length;
  return {
    id: s.id,
    guildId: s.guildId,
    channelId: s.channelId,
    messageId: s.messageId,
    authorId: s.authorId,
    content: s.content,
    status: s.status as 'open' | 'accepted' | 'rejected' | 'implemented',
    reviewNote: s.reviewNote,
    reviewedBy: s.reviewedBy,
    reviewedAt: s.reviewedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    votes: { up, down },
  };
}

export const communityRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Sticky messages ─────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/sticky-messages',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.stickyMessage.findMany({
        where: { guildId: req.params.guildId },
      });
      return { sticky: items.map(serializeSticky) };
    },
  );

  app.get(
    '/guilds/:guildId/sticky-messages/:channelId',
    { preHandler: app.requireBot(), schema: { params: ChannelParams } },
    async (req) => {
      const item = await app.prisma.stickyMessage.findUnique({
        where: {
          guildId_channelId: { guildId: req.params.guildId, channelId: req.params.channelId },
        },
      });
      if (!item) throw HttpError.notFound('No sticky in this channel.');
      return serializeSticky(item);
    },
  );

  app.put(
    '/guilds/:guildId/sticky-messages',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertStickyMessageSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const item = await app.prisma.stickyMessage.upsert({
        where: {
          guildId_channelId: { guildId, channelId: req.body.channelId },
        },
        update: {
          content: req.body.content,
          ...(req.body.throttleMessages !== undefined
            ? { throttleMessages: req.body.throttleMessages }
            : {}),
          ...(req.body.enabled !== undefined ? { enabled: req.body.enabled } : {}),
        },
        create: {
          guildId,
          channelId: req.body.channelId,
          content: req.body.content,
          throttleMessages: req.body.throttleMessages ?? 5,
          enabled: req.body.enabled ?? true,
        },
      });
      return serializeSticky(item);
    },
  );

  // Bot updates the last-posted message id so it can delete the previous instance.
  app.patch(
    '/guilds/:guildId/sticky-messages/:channelId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: ChannelParams,
        body: z.object({ lastMessageId: SnowflakeSchema.nullable() }),
      },
    },
    async (req) => {
      const item = await app.prisma.stickyMessage.update({
        where: {
          guildId_channelId: {
            guildId: req.params.guildId,
            channelId: req.params.channelId,
          },
        },
        data: { lastMessageId: req.body.lastMessageId },
      });
      return serializeSticky(item);
    },
  );

  app.delete(
    '/guilds/:guildId/sticky-messages/:channelId',
    { preHandler: app.requireBot(), schema: { params: ChannelParams } },
    async (req, reply) => {
      const result = await app.prisma.stickyMessage.deleteMany({
        where: { guildId: req.params.guildId, channelId: req.params.channelId },
      });
      if (result.count === 0) throw HttpError.notFound('No sticky in this channel.');
      return reply.code(204).send();
    },
  );

  // ─── Suggestions ─────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/suggestions',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          status: z.enum(['open', 'accepted', 'rejected', 'implemented']).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const items = await app.prisma.suggestion.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        include: { votes: true },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { suggestions: items.map(serializeSuggestion) };
    },
  );

  app.get(
    '/guilds/:guildId/suggestions/:suggestionId',
    { preHandler: app.requireBot(), schema: { params: SuggestionParams } },
    async (req) => {
      const item = await app.prisma.suggestion.findFirst({
        where: { id: req.params.suggestionId, guildId: req.params.guildId },
        include: { votes: true },
      });
      if (!item) throw HttpError.notFound('Suggestion not found.');
      return serializeSuggestion(item);
    },
  );

  app.post(
    '/guilds/:guildId/suggestions',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateSuggestionSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const item = await app.prisma.suggestion.create({
        data: {
          guildId,
          channelId: req.body.channelId,
          authorId: req.body.authorId,
          content: req.body.content,
        },
        include: { votes: true },
      });
      return serializeSuggestion(item);
    },
  );

  app.patch(
    '/guilds/:guildId/suggestions/:suggestionId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: SuggestionParams,
        body: z.object({ messageId: SnowflakeSchema.nullable().optional() }),
      },
    },
    async (req) => {
      const item = await app.prisma.suggestion.update({
        where: { id: req.params.suggestionId },
        data: {
          ...(req.body.messageId !== undefined ? { messageId: req.body.messageId } : {}),
        },
        include: { votes: true },
      });
      return serializeSuggestion(item);
    },
  );

  app.post(
    '/guilds/:guildId/suggestions/:suggestionId/review',
    {
      preHandler: app.requireBot(),
      schema: { params: SuggestionParams, body: ReviewSuggestionSchema },
    },
    async (req) => {
      const item = await app.prisma.suggestion.update({
        where: { id: req.params.suggestionId },
        data: {
          status: req.body.status,
          reviewNote: req.body.reviewNote ?? null,
          reviewedBy: req.body.reviewedBy,
          reviewedAt: new Date(),
        },
        include: { votes: true },
      });
      return serializeSuggestion(item);
    },
  );

  app.post(
    '/guilds/:guildId/suggestions/:suggestionId/vote',
    {
      preHandler: app.requireBot(),
      schema: {
        params: SuggestionParams,
        body: z.object({
          userId: SnowflakeSchema,
          vote: z.number().int().min(-1).max(1),
        }),
      },
    },
    async (req) => {
      const { suggestionId } = req.params;
      const { userId, vote } = req.body;
      if (vote === 0) {
        await app.prisma.suggestionVote.deleteMany({ where: { suggestionId, userId } });
      } else {
        await app.prisma.suggestionVote.upsert({
          where: { suggestionId_userId: { suggestionId, userId } },
          update: { vote },
          create: { suggestionId, userId, vote },
        });
      }
      const item = await app.prisma.suggestion.findUniqueOrThrow({
        where: { id: suggestionId },
        include: { votes: true },
      });
      return serializeSuggestion(item);
    },
  );

  // ─── Custom embed builder — bot posts a one-off embed to a channel ──
  app.post(
    '/guilds/:guildId/post-embed',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: EmbedBuilderSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const body = req.body;
      const embed: Record<string, unknown> = {
        ...(body.title ? { title: body.title } : {}),
        ...(body.description ? { description: body.description } : {}),
        ...(body.url ? { url: body.url } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.imageUrl ? { image: { url: body.imageUrl } } : {}),
        ...(body.thumbnailUrl ? { thumbnail: { url: body.thumbnailUrl } } : {}),
        ...(body.footer ? { footer: { text: body.footer } } : {}),
        ...(body.fields ? { fields: body.fields } : {}),
      };
      // Queue via PendingPost — the bot drains and delivers.
      const post = await app.prisma.pendingPost.create({
        data: {
          guildId,
          channelId: body.channelId,
          embedJson: embed as never,
          source: 'embed-builder',
        },
      });
      return { id: post.id };
    },
  );
};
