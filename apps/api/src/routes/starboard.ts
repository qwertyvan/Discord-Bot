import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { StarboardConfig as PrismaStarboardConfig, StarboardEntry as PrismaStarboardEntry } from '@prisma/client';
import { z } from 'zod';
import {
  RecordStarSchema,
  SetStarboardMessageIdSchema,
  SnowflakeSchema,
  UpsertStarboardConfigSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const EntryParams = z.object({ guildId: SnowflakeSchema, sourceMessageId: SnowflakeSchema });

function serializeConfig(guildId: string, cfg: PrismaStarboardConfig | null) {
  return {
    guildId,
    channelId: cfg?.channelId ?? null,
    threshold: cfg?.threshold ?? 3,
    emoji: cfg?.emoji ?? '⭐',
    allowNsfw: cfg?.allowNsfw ?? false,
    enabled: cfg?.enabled ?? false,
    updatedAt: (cfg?.updatedAt ?? new Date(0)).toISOString(),
  };
}

function serializeEntry(entry: PrismaStarboardEntry) {
  return {
    sourceMessageId: entry.sourceMessageId,
    starboardMessageId: entry.starboardMessageId,
    guildId: entry.guildId,
    authorId: entry.authorId,
    channelId: entry.channelId,
    starCount: entry.starCount,
    content: entry.content,
    attachmentUrl: entry.attachmentUrl,
    firstStarredAt: entry.firstStarredAt.toISOString(),
  };
}

export const starboardRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Config ─────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/starboard-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.starboardConfig.findUnique({ where: { guildId } });
      return serializeConfig(guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/starboard-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertStarboardConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const patch = req.body;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const update: Record<string, unknown> = {};
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.threshold !== undefined) update.threshold = patch.threshold;
      if (patch.emoji !== undefined) update.emoji = patch.emoji;
      if (patch.allowNsfw !== undefined) update.allowNsfw = patch.allowNsfw;
      if (patch.enabled !== undefined) update.enabled = patch.enabled;

      const cfg = await app.prisma.starboardConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          channelId: patch.channelId ?? null,
          threshold: patch.threshold ?? 3,
          emoji: patch.emoji ?? '⭐',
          allowNsfw: patch.allowNsfw ?? false,
          enabled: patch.enabled ?? false,
        },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  // ─── Entries ────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/starboard-entries',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          top: z.coerce.number().int().min(1).max(50).default(10),
          days: z.coerce.number().int().min(1).max(365).default(7),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const since = new Date(Date.now() - req.query.days * 24 * 60 * 60 * 1000);
      const entries = await app.prisma.starboardEntry.findMany({
        where: { guildId, firstStarredAt: { gte: since } },
        orderBy: [{ starCount: 'desc' }, { firstStarredAt: 'desc' }],
        take: req.query.top,
      });
      return { entries: entries.map(serializeEntry) };
    },
  );

  // Bot reports the current observed star count for a source message. Creates
  // the row on first sighting, or updates `starCount` (and content fields if
  // the row exists but wasn't seeded with them yet).
  app.post(
    '/guilds/:guildId/starboard-entries',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: RecordStarSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const body = req.body;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const entry = await app.prisma.starboardEntry.upsert({
        where: { sourceMessageId: body.sourceMessageId },
        update: {
          starCount: body.starCount,
          content: body.content,
          ...(body.attachmentUrl !== undefined ? { attachmentUrl: body.attachmentUrl } : {}),
        },
        create: {
          sourceMessageId: body.sourceMessageId,
          guildId,
          authorId: body.authorId,
          channelId: body.channelId,
          starCount: body.starCount,
          content: body.content,
          attachmentUrl: body.attachmentUrl ?? null,
        },
      });
      return serializeEntry(entry);
    },
  );

  app.patch(
    '/guilds/:guildId/starboard-entries/:sourceMessageId',
    {
      preHandler: app.requireBot(),
      schema: { params: EntryParams, body: SetStarboardMessageIdSchema },
    },
    async (req) => {
      const { guildId, sourceMessageId } = req.params;
      const entry = await app.prisma.starboardEntry.findFirst({
        where: { sourceMessageId, guildId },
      });
      if (!entry) throw HttpError.notFound('Starboard entry not found.');
      const updated = await app.prisma.starboardEntry.update({
        where: { sourceMessageId },
        data: { starboardMessageId: req.body.starboardMessageId },
      });
      return serializeEntry(updated);
    },
  );
};
