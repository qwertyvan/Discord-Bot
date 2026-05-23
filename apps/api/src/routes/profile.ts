import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  ProfileBadge as PrismaProfileBadge,
  UserBadge as PrismaUserBadge,
  UserProfile as PrismaUserProfile,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateProfileBadgeSchema,
  GrantUserBadgeSchema,
  SnowflakeSchema,
  UpsertUserProfileSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const GuildUserParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });
const GuildSlugParams = z.object({
  guildId: SnowflakeSchema,
  slug: z.string().min(1).max(48),
});
const GuildSlugUserParams = z.object({
  guildId: SnowflakeSchema,
  slug: z.string().min(1).max(48),
  userId: SnowflakeSchema,
});

function serializeBadge(b: PrismaProfileBadge) {
  return {
    id: b.id,
    guildId: b.guildId,
    slug: b.slug,
    name: b.name,
    emoji: b.emoji,
    description: b.description,
    createdAt: b.createdAt.toISOString(),
  };
}

function serializeUserBadge(ub: PrismaUserBadge & { badge: PrismaProfileBadge }) {
  return {
    guildId: ub.guildId,
    userId: ub.userId,
    badgeId: ub.badgeId,
    awardedAt: ub.awardedAt.toISOString(),
    awardedBy: ub.awardedBy,
    badge: serializeBadge(ub.badge),
  };
}

function serializeProfile(
  p: PrismaUserProfile | null,
  guildId: string,
  userId: string,
  badges: Array<PrismaUserBadge & { badge: PrismaProfileBadge }>,
) {
  // When the user has no profile row yet we still return a "blank" payload so
  // the bot can render an empty profile without an extra null check on every
  // field. The badges array may still have entries if a mod granted badges
  // before the user edited their profile.
  return {
    guildId,
    userId,
    bio: p?.bio ?? null,
    accentColor: p?.accentColor ?? null,
    favoriteQuote: p?.favoriteQuote ?? null,
    updatedAt: (p?.updatedAt ?? new Date(0)).toISOString(),
    badges: badges.map(serializeUserBadge),
  };
}

export const profileRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Profile (per guild,user) ─────────────────────────────────────────
  app.get(
    '/guilds/:guildId/profile/:userId',
    { preHandler: app.requireBot(), schema: { params: GuildUserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const [profile, badges] = await Promise.all([
        app.prisma.userProfile.findUnique({ where: { guildId_userId: { guildId, userId } } }),
        app.prisma.userBadge.findMany({
          where: { guildId, userId },
          include: { badge: true },
          orderBy: { awardedAt: 'asc' },
        }),
      ]);
      return serializeProfile(profile, guildId, userId, badges);
    },
  );

  app.put(
    '/guilds/:guildId/profile/:userId',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildUserParams, body: UpsertUserProfileSchema },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      // We rebuild the update/create objects explicitly so undefined fields
      // are skipped (exactOptionalPropertyTypes-friendly) but null clears.
      const data: {
        bio?: string | null;
        accentColor?: string | null;
        favoriteQuote?: string | null;
      } = {};
      if (req.body.bio !== undefined) data.bio = req.body.bio;
      if (req.body.accentColor !== undefined) data.accentColor = req.body.accentColor;
      if (req.body.favoriteQuote !== undefined) data.favoriteQuote = req.body.favoriteQuote;

      const profile = await app.prisma.userProfile.upsert({
        where: { guildId_userId: { guildId, userId } },
        update: data,
        create: { guildId, userId, ...data },
      });
      const badges = await app.prisma.userBadge.findMany({
        where: { guildId, userId },
        include: { badge: true },
        orderBy: { awardedAt: 'asc' },
      });
      return serializeProfile(profile, guildId, userId, badges);
    },
  );

  // ─── Profile badge catalog (per guild) ────────────────────────────────
  app.get(
    '/guilds/:guildId/profile-badges',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const badges = await app.prisma.profileBadge.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'asc' },
      });
      return { badges: badges.map(serializeBadge) };
    },
  );

  app.post(
    '/guilds/:guildId/profile-badges',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateProfileBadgeSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const badge = await app.prisma.profileBadge.create({
        data: {
          guildId,
          slug: req.body.slug,
          name: req.body.name,
          emoji: req.body.emoji,
          description: req.body.description ?? null,
        },
      });
      return serializeBadge(badge);
    },
  );

  app.delete(
    '/guilds/:guildId/profile-badges/:slug',
    { preHandler: app.requireBot(), schema: { params: GuildSlugParams } },
    async (req, reply) => {
      const result = await app.prisma.profileBadge.deleteMany({
        where: { guildId: req.params.guildId, slug: req.params.slug },
      });
      if (result.count === 0) throw HttpError.notFound('Badge not found.');
      return reply.code(204).send();
    },
  );

  // ─── Grants ───────────────────────────────────────────────────────────
  // Grant a badge to a user. Idempotent: re-granting silently no-ops on the
  // unique constraint (we use upsert).
  app.post(
    '/guilds/:guildId/profile-badges/:slug/grant',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildSlugParams, body: GrantUserBadgeSchema },
    },
    async (req) => {
      const { guildId, slug } = req.params;
      const badge = await app.prisma.profileBadge.findUnique({
        where: { guildId_slug: { guildId, slug } },
      });
      if (!badge) throw HttpError.notFound('Badge not found.');
      const grant = await app.prisma.userBadge.upsert({
        where: {
          guildId_userId_badgeId: { guildId, userId: req.body.userId, badgeId: badge.id },
        },
        update: req.body.awardedBy !== undefined ? { awardedBy: req.body.awardedBy } : {},
        create: {
          guildId,
          userId: req.body.userId,
          badgeId: badge.id,
          awardedBy: req.body.awardedBy ?? null,
        },
        include: { badge: true },
      });
      return serializeUserBadge(grant);
    },
  );

  app.delete(
    '/guilds/:guildId/profile-badges/:slug/users/:userId',
    { preHandler: app.requireBot(), schema: { params: GuildSlugUserParams } },
    async (req, reply) => {
      const { guildId, slug, userId } = req.params;
      const badge = await app.prisma.profileBadge.findUnique({
        where: { guildId_slug: { guildId, slug } },
      });
      if (!badge) throw HttpError.notFound('Badge not found.');
      const result = await app.prisma.userBadge.deleteMany({
        where: { guildId, userId, badgeId: badge.id },
      });
      if (result.count === 0) throw HttpError.notFound('User does not have that badge.');
      return reply.code(204).send();
    },
  );
};
