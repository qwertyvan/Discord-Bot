import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Quote as PrismaQuote, QuoteConfig as PrismaQuoteConfig } from '@prisma/client';
import { z } from 'zod';
import {
  CreateQuoteSchema,
  QuoteListQuerySchema,
  QuoteSavePermissionSchema,
  QuoteTopQuerySchema,
  SnowflakeSchema,
  UpsertQuoteConfigSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const QuoteParams = z.object({ guildId: SnowflakeSchema, quoteId: z.string().uuid() });

function serializeConfig(guildId: string, cfg: PrismaQuoteConfig | null) {
  return {
    guildId,
    channelId: cfg?.channelId ?? null,
    savePermission: (cfg?.savePermission ?? 'everyone') as
      | 'everyone'
      | 'trusted-role'
      | 'mods',
    trustedRoleId: cfg?.trustedRoleId ?? null,
    weeklyDigest: cfg?.weeklyDigest ?? false,
  };
}

function serializeQuote(q: PrismaQuote) {
  return {
    id: q.id,
    guildId: q.guildId,
    sourceMessageId: q.sourceMessageId,
    sourceChannelId: q.sourceChannelId,
    authorId: q.authorId,
    savedBy: q.savedBy,
    content: q.content,
    attachmentUrl: q.attachmentUrl,
    savedAt: q.savedAt.toISOString(),
    reactionCount: q.reactionCount,
  };
}

export const quotesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Config ─────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/quote-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const cfg = await app.prisma.quoteConfig.findUnique({
        where: { guildId: req.params.guildId },
      });
      return serializeConfig(req.params.guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/quote-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertQuoteConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.savePermission !== undefined) update.savePermission = patch.savePermission;
      if (patch.trustedRoleId !== undefined) update.trustedRoleId = patch.trustedRoleId;
      if (patch.weeklyDigest !== undefined) update.weeklyDigest = patch.weeklyDigest;

      const cfg = await app.prisma.quoteConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          channelId: patch.channelId ?? null,
          savePermission: patch.savePermission ?? 'everyone',
          trustedRoleId: patch.trustedRoleId ?? null,
          weeklyDigest: patch.weeklyDigest ?? false,
        },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  // ─── Quotes — list / filter / search ────────────────────────────────
  app.get(
    '/guilds/:guildId/quotes',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, querystring: QuoteListQuerySchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { authorId, savedBy, search, limit, offset } = req.query;
      const items = await app.prisma.quote.findMany({
        where: {
          guildId,
          ...(authorId ? { authorId } : {}),
          ...(savedBy ? { savedBy } : {}),
          ...(search ? { content: { contains: search, mode: 'insensitive' } } : {}),
        },
        orderBy: { savedAt: 'desc' },
        take: limit,
        skip: offset,
      });
      const total = await app.prisma.quote.count({
        where: {
          guildId,
          ...(authorId ? { authorId } : {}),
          ...(savedBy ? { savedBy } : {}),
          ...(search ? { content: { contains: search, mode: 'insensitive' } } : {}),
        },
      });
      return { quotes: items.map(serializeQuote), total };
    },
  );

  // Random quote (optionally filtered by author).
  app.get(
    '/guilds/:guildId/quotes/random',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({ authorId: SnowflakeSchema.optional() }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const where = {
        guildId,
        ...(req.query.authorId ? { authorId: req.query.authorId } : {}),
      };
      const count = await app.prisma.quote.count({ where });
      if (count === 0) throw HttpError.notFound('No quotes saved yet.');
      const skip = Math.floor(Math.random() * count);
      const [pick] = await app.prisma.quote.findMany({ where, take: 1, skip });
      if (!pick) throw HttpError.notFound('No quotes saved yet.');
      return serializeQuote(pick);
    },
  );

  // Top quotes for digest (sorted by reactionCount, then savedAt desc).
  app.get(
    '/guilds/:guildId/quotes/top',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, querystring: QuoteTopQuerySchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const since = new Date(Date.now() - req.query.days * 24 * 60 * 60 * 1000);
      const items = await app.prisma.quote.findMany({
        where: { guildId, savedAt: { gte: since } },
        orderBy: [{ reactionCount: 'desc' }, { savedAt: 'desc' }],
        take: req.query.limit,
      });
      return { quotes: items.map(serializeQuote) };
    },
  );

  // Get one quote by id.
  app.get(
    '/guilds/:guildId/quotes/:quoteId',
    { preHandler: app.requireBot(), schema: { params: QuoteParams } },
    async (req) => {
      const item = await app.prisma.quote.findFirst({
        where: { id: req.params.quoteId, guildId: req.params.guildId },
      });
      if (!item) throw HttpError.notFound('Quote not found.');
      return serializeQuote(item);
    },
  );

  // Create — bot calls this from the "Save quote" context command.
  app.post(
    '/guilds/:guildId/quotes',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateQuoteSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const body = req.body;
      const item = await app.prisma.quote.create({
        data: {
          guildId,
          sourceMessageId: body.sourceMessageId,
          sourceChannelId: body.sourceChannelId,
          authorId: body.authorId,
          savedBy: body.savedBy,
          content: body.content,
          ...(body.attachmentUrl !== undefined ? { attachmentUrl: body.attachmentUrl } : {}),
          ...(body.reactionCount !== undefined ? { reactionCount: body.reactionCount } : {}),
        },
      });
      return serializeQuote(item);
    },
  );

  // Bot bumps the cached reaction count on the saved row.
  app.patch(
    '/guilds/:guildId/quotes/:quoteId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: QuoteParams,
        body: z.object({ reactionCount: z.number().int().nonnegative() }),
      },
    },
    async (req) => {
      const existing = await app.prisma.quote.findFirst({
        where: { id: req.params.quoteId, guildId: req.params.guildId },
      });
      if (!existing) throw HttpError.notFound('Quote not found.');
      const item = await app.prisma.quote.update({
        where: { id: req.params.quoteId },
        data: { reactionCount: req.body.reactionCount },
      });
      return serializeQuote(item);
    },
  );

  // Delete — only the user who saved it, or anyone with ManageMessages on
  // the bot side. Server-side we just check `requesterId` matches `savedBy`
  // OR `force` is set (bot already verified ManageMessages).
  app.delete(
    '/guilds/:guildId/quotes/:quoteId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: QuoteParams,
        querystring: z.object({
          requesterId: SnowflakeSchema,
          force: z.coerce.boolean().optional(),
        }),
      },
    },
    async (req, reply) => {
      const existing = await app.prisma.quote.findFirst({
        where: { id: req.params.quoteId, guildId: req.params.guildId },
      });
      if (!existing) throw HttpError.notFound('Quote not found.');
      if (!req.query.force && existing.savedBy !== req.query.requesterId) {
        throw HttpError.forbidden('Only the saver or a moderator can delete this quote.');
      }
      await app.prisma.quote.delete({ where: { id: req.params.quoteId } });
      return reply.code(204).send();
    },
  );

  // Keep referenced schemas in scope so unused-import lint doesn't trip.
  void QuoteSavePermissionSchema;
};
