import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  Achievement as PrismaAchievement,
  UserAchievement as PrismaUserAchievement,
} from '@prisma/client';
import { z } from 'zod';
import {
  AchievementKindSchema,
  AwardAchievementSchema,
  CreateAchievementSchema,
  SnowflakeSchema,
  UpdateAchievementSchema,
  type Achievement,
  type AchievementKind,
  type UserAchievement,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const AchievementParams = z.object({
  guildId: SnowflakeSchema,
  achievementId: z.string().uuid(),
});

// Curated default catalogue. Inserted on demand by the `seed` endpoint so
// freshly-onboarded guilds can opt in without a migration step.
const STOCK_SEEDS: ReadonlyArray<{
  slug: string;
  name: string;
  description: string;
  emoji: string;
  kind: AchievementKind;
  threshold: number;
  badgeSlug: string | null;
  currencyReward: number;
}> = [
  {
    slug: 'first-message',
    name: 'First Message',
    description: 'Send your very first message in the server.',
    emoji: '💬',
    kind: 'messages',
    threshold: 1,
    badgeSlug: 'first-message',
    currencyReward: 10,
  },
  {
    slug: '100-messages',
    name: 'Centurion',
    description: 'Send 100 messages in the server.',
    emoji: '📝',
    kind: 'messages',
    threshold: 100,
    badgeSlug: null,
    currencyReward: 50,
  },
  {
    slug: '1000-messages',
    name: 'Chatterbox',
    description: 'Send 1,000 messages in the server.',
    emoji: '🗣️',
    kind: 'messages',
    threshold: 1000,
    badgeSlug: 'chatterbox',
    currencyReward: 250,
  },
  {
    slug: 'first-voice-min',
    name: 'First Words',
    description: 'Spend your first minute in a voice channel.',
    emoji: '🎙️',
    kind: 'voice_minutes',
    threshold: 1,
    badgeSlug: null,
    currencyReward: 10,
  },
  {
    slug: '10h-voice',
    name: 'Voice Veteran',
    description: 'Accumulate 10 hours (600 minutes) of voice activity.',
    emoji: '🎧',
    kind: 'voice_minutes',
    threshold: 600,
    badgeSlug: 'voice-veteran',
    currencyReward: 250,
  },
  {
    slug: 'level-10',
    name: 'On the Rise',
    description: 'Reach level 10.',
    emoji: '⭐',
    kind: 'level',
    threshold: 10,
    badgeSlug: null,
    currencyReward: 100,
  },
  {
    slug: 'level-50',
    name: 'Legend',
    description: 'Reach level 50.',
    emoji: '🌟',
    kind: 'level',
    threshold: 50,
    badgeSlug: 'legend',
    currencyReward: 500,
  },
  {
    slug: 'first-reaction',
    name: 'First Reaction',
    description: 'Add your first reaction to a message.',
    emoji: '👍',
    kind: 'reactions',
    threshold: 1,
    badgeSlug: null,
    currencyReward: 5,
  },
  {
    slug: 'sticker-collector',
    name: 'Sticker Collector',
    description: 'Use stickers in 25 messages.',
    emoji: '🪧',
    kind: 'stickers',
    threshold: 25,
    badgeSlug: 'sticker-collector',
    currencyReward: 100,
  },
  {
    slug: 'helper-of-the-day',
    name: 'Helper of the Day',
    description: 'Recognised by staff for outstanding help.',
    emoji: '🤝',
    kind: 'custom',
    threshold: 1,
    badgeSlug: 'helper',
    currencyReward: 100,
  },
];

function serializeAchievement(a: PrismaAchievement): Achievement {
  return {
    id: a.id,
    guildId: a.guildId,
    slug: a.slug,
    name: a.name,
    description: a.description,
    emoji: a.emoji,
    kind: a.kind as AchievementKind,
    threshold: a.threshold,
    badgeSlug: a.badgeSlug,
    currencyReward: a.currencyReward,
    enabled: a.enabled,
    createdAt: a.createdAt.toISOString(),
  };
}

function serializeUserAchievement(ua: PrismaUserAchievement): UserAchievement {
  return {
    guildId: ua.guildId,
    userId: ua.userId,
    achievementId: ua.achievementId,
    unlockedAt: ua.unlockedAt.toISOString(),
    progressAtUnlock: ua.progressAtUnlock,
  };
}

export const achievementsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Catalogue ──────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/achievements',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          kind: AchievementKindSchema.optional(),
          enabled: z.coerce.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const where: Record<string, unknown> = { guildId: req.params.guildId };
      if (req.query.kind) where.kind = req.query.kind;
      if (req.query.enabled !== undefined) where.enabled = req.query.enabled;
      const rows = await app.prisma.achievement.findMany({
        where,
        orderBy: [{ kind: 'asc' }, { threshold: 'asc' }, { name: 'asc' }],
      });
      return { achievements: rows.map(serializeAchievement) };
    },
  );

  app.post(
    '/guilds/:guildId/achievements',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateAchievementSchema },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const row = await app.prisma.achievement.create({
        data: {
          guildId,
          slug: req.body.slug,
          name: req.body.name,
          description: req.body.description,
          ...(req.body.emoji !== undefined ? { emoji: req.body.emoji } : {}),
          kind: req.body.kind,
          threshold: req.body.threshold,
          ...(req.body.badgeSlug !== undefined ? { badgeSlug: req.body.badgeSlug } : {}),
          ...(req.body.currencyReward !== undefined
            ? { currencyReward: req.body.currencyReward }
            : {}),
          ...(req.body.enabled !== undefined ? { enabled: req.body.enabled } : {}),
        },
      });
      reply.code(201);
      return serializeAchievement(row);
    },
  );

  app.patch(
    '/guilds/:guildId/achievements/:achievementId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: AchievementParams,
        body: UpdateAchievementSchema,
      },
    },
    async (req) => {
      const { guildId, achievementId } = req.params;
      const existing = await app.prisma.achievement.findFirst({
        where: { id: achievementId, guildId },
      });
      if (!existing) throw HttpError.notFound('Achievement not found.');
      const update: Record<string, unknown> = {};
      if (req.body.name !== undefined) update.name = req.body.name;
      if (req.body.description !== undefined) update.description = req.body.description;
      if (req.body.emoji !== undefined) update.emoji = req.body.emoji;
      if (req.body.kind !== undefined) update.kind = req.body.kind;
      if (req.body.threshold !== undefined) update.threshold = req.body.threshold;
      if (req.body.badgeSlug !== undefined) update.badgeSlug = req.body.badgeSlug;
      if (req.body.currencyReward !== undefined) update.currencyReward = req.body.currencyReward;
      if (req.body.enabled !== undefined) update.enabled = req.body.enabled;
      const row = await app.prisma.achievement.update({
        where: { id: achievementId },
        data: update,
      });
      return serializeAchievement(row);
    },
  );

  app.delete(
    '/guilds/:guildId/achievements/:achievementId',
    {
      preHandler: app.requireBot(),
      schema: { params: AchievementParams },
    },
    async (req, reply) => {
      const { guildId, achievementId } = req.params;
      const result = await app.prisma.achievement.deleteMany({
        where: { id: achievementId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Achievement not found.');
      return reply.code(204).send();
    },
  );

  // Convenience: delete by slug so the slash command doesn't need to pre-fetch.
  app.delete(
    '/guilds/:guildId/achievements/by-slug/:slug',
    {
      preHandler: app.requireBot(),
      schema: {
        params: z.object({ guildId: SnowflakeSchema, slug: z.string().min(1).max(48) }),
      },
    },
    async (req, reply) => {
      const result = await app.prisma.achievement.deleteMany({
        where: { guildId: req.params.guildId, slug: req.params.slug },
      });
      if (result.count === 0) throw HttpError.notFound('Achievement not found.');
      return reply.code(204).send();
    },
  );

  // ─── User unlocks ───────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/user-achievements',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          userId: SnowflakeSchema.optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
      },
    },
    async (req) => {
      const where: Record<string, unknown> = { guildId: req.params.guildId };
      if (req.query.userId) where.userId = req.query.userId;
      const rows = await app.prisma.userAchievement.findMany({
        where,
        orderBy: { unlockedAt: 'desc' },
        take: req.query.limit,
      });
      return { userAchievements: rows.map(serializeUserAchievement) };
    },
  );

  app.post(
    '/guilds/:guildId/user-achievements/award',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: AwardAchievementSchema },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const achievement = await app.prisma.achievement.findUnique({
        where: { guildId_slug: { guildId, slug: req.body.slug } },
      });
      if (!achievement) throw HttpError.notFound('Achievement not found.');
      if (!achievement.enabled) {
        reply.code(200);
        return {
          unlocked: false as const,
          achievement: serializeAchievement(achievement),
          userAchievement: null,
        };
      }
      // Idempotent: if already unlocked, return the existing row with
      // `unlocked: false` so the caller knows not to re-celebrate.
      const existing = await app.prisma.userAchievement.findUnique({
        where: {
          guildId_userId_achievementId: {
            guildId,
            userId: req.body.userId,
            achievementId: achievement.id,
          },
        },
      });
      if (existing) {
        reply.code(200);
        return {
          unlocked: false as const,
          achievement: serializeAchievement(achievement),
          userAchievement: serializeUserAchievement(existing),
        };
      }
      const created = await app.prisma.userAchievement.create({
        data: {
          guildId,
          userId: req.body.userId,
          achievementId: achievement.id,
          progressAtUnlock: req.body.progress,
        },
      });
      reply.code(201);
      return {
        unlocked: true as const,
        achievement: serializeAchievement(achievement),
        userAchievement: serializeUserAchievement(created),
      };
    },
  );

  // ─── Stock-seed installer (idempotent) ──────────────────────────────
  app.post(
    '/guilds/:guildId/achievements/seed',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const existing = await app.prisma.achievement.findMany({
        where: { guildId, slug: { in: STOCK_SEEDS.map((s) => s.slug) } },
        select: { slug: true },
      });
      const have = new Set(existing.map((e) => e.slug));
      const toInsert = STOCK_SEEDS.filter((s) => !have.has(s.slug));
      if (toInsert.length > 0) {
        await app.prisma.achievement.createMany({
          data: toInsert.map((s) => ({
            guildId,
            slug: s.slug,
            name: s.name,
            description: s.description,
            emoji: s.emoji,
            kind: s.kind,
            threshold: s.threshold,
            badgeSlug: s.badgeSlug,
            currencyReward: s.currencyReward,
            enabled: true,
          })),
        });
      }
      const all = await app.prisma.achievement.findMany({
        where: { guildId },
        orderBy: [{ kind: 'asc' }, { threshold: 'asc' }],
      });
      return {
        inserted: toInsert.length,
        skipped: STOCK_SEEDS.length - toInsert.length,
        achievements: all.map(serializeAchievement),
      };
    },
  );
};
