import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import type {
  FishingCast as PrismaFishingCast,
  FishingDrop as PrismaFishingDrop,
  FishingSkill as PrismaFishingSkill,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateFishingDropSchema,
  FISHING_LEVEL_THRESHOLDS,
  SnowflakeSchema,
  fishingTierForLevel,
  type CastResult,
  type FishingCast,
  type FishingDrop,
  type FishingSkill,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { SeededRng, weightedPick } from '../util/game-engines.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const SkillParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });
const DropParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });

// 30-second cast timer + a 5-minute cap on stale unresolved casts. Casts
// older than the cap are auto-resolved by the scheduler tick so they don't
// block the user from casting again.
const CAST_DURATION_MS = 30_000;
const STALE_CAST_WINDOW_MS = 5 * 60_000;

function serializeSkill(s: PrismaFishingSkill | null, guildId: string, userId: string): FishingSkill {
  const xp = s?.xp ?? 0;
  const level = s?.level ?? 1;
  // Find the smallest threshold strictly greater than the current xp;
  // null if the player has hit the top of the table.
  const next = FISHING_LEVEL_THRESHOLDS.find((t) => t > xp) ?? null;
  return {
    guildId,
    userId,
    xp,
    level,
    casts: s?.casts ?? 0,
    tier: fishingTierForLevel(level),
    nextLevelXp: next,
  };
}

function serializeDrop(d: PrismaFishingDrop): FishingDrop {
  return {
    id: d.id,
    guildId: d.guildId,
    slug: d.slug,
    itemId: d.itemId,
    name: d.name,
    emoji: d.emoji,
    minLevel: d.minLevel,
    weight: d.weight,
    currencyMin: d.currencyMin,
    currencyMax: d.currencyMax,
    xpReward: d.xpReward,
    enabled: d.enabled,
  };
}

function serializeCast(c: PrismaFishingCast): FishingCast {
  return {
    id: c.id,
    guildId: c.guildId,
    userId: c.userId,
    startedAt: c.startedAt.toISOString(),
    resolvesAt: c.resolvesAt.toISOString(),
    resolved: c.resolved,
    dropId: c.dropId,
    currencyEarned: c.currencyEarned,
    xpEarned: c.xpEarned,
  };
}

// Stock drops used by /fish admin seed. minLevel is staged so the table is
// approachable for fresh skill-1 players but rewards keep climbing for
// intermediate/master fishers.
const STOCK_DROPS: ReadonlyArray<{
  slug: string;
  name: string;
  emoji: string;
  minLevel: number;
  weight: number;
  currencyMin: number;
  currencyMax: number;
  xpReward: number;
}> = [
  { slug: 'old-boot',     name: 'Old Boot',         emoji: '🥾', minLevel: 1, weight: 30, currencyMin: 0,  currencyMax: 1,   xpReward: 2 },
  { slug: 'minnow',       name: 'Minnow',           emoji: '🐟', minLevel: 1, weight: 40, currencyMin: 2,  currencyMax: 6,   xpReward: 5 },
  { slug: 'herring',      name: 'Herring',          emoji: '🐠', minLevel: 1, weight: 25, currencyMin: 4,  currencyMax: 10,  xpReward: 8 },
  { slug: 'sea-bass',     name: 'Sea Bass',         emoji: '🐡', minLevel: 2, weight: 18, currencyMin: 10, currencyMax: 25,  xpReward: 14 },
  { slug: 'swordfish',    name: 'Swordfish',        emoji: '🗡️', minLevel: 2, weight: 10, currencyMin: 25, currencyMax: 60,  xpReward: 22 },
  { slug: 'pearl-oyster', name: 'Pearl Oyster',     emoji: '🦪', minLevel: 3, weight: 6,  currencyMin: 50, currencyMax: 120, xpReward: 30 },
  { slug: 'kraken-spawn', name: 'Kraken Spawn',     emoji: '🐙', minLevel: 3, weight: 2,  currencyMin: 150, currencyMax: 400, xpReward: 50 },
];

export const fishingRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Skill ──────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/fishing/skill/:userId',
    { preHandler: app.requireBot(), schema: { params: SkillParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      // Auto-create so the bot can render "level 1, 0 xp" without a 404.
      const existing = await app.prisma.fishingSkill.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      if (existing) return serializeSkill(existing, guildId, userId);
      // Verify the guild is registered before creating a skill row so we
      // don't end up with orphan FishingSkill rows for unregistered guilds.
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const created = await app.prisma.fishingSkill.create({
        data: { guildId, userId },
      });
      return serializeSkill(created, guildId, userId);
    },
  );

  // ── Drops ──────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/fishing/drops',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const drops = await app.prisma.fishingDrop.findMany({
        where: { guildId: req.params.guildId },
        orderBy: [{ minLevel: 'asc' }, { weight: 'desc' }, { slug: 'asc' }],
      });
      return { drops: drops.map(serializeDrop) };
    },
  );

  app.post(
    '/guilds/:guildId/fishing/drops',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateFishingDropSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const body = req.body;
      if (body.currencyMax < body.currencyMin) {
        throw HttpError.badRequest('currencyMax must be >= currencyMin.');
      }
      if (body.itemId) {
        const item = await app.prisma.shopItem.findFirst({
          where: { id: body.itemId, guildId },
        });
        if (!item) throw HttpError.badRequest('itemId does not reference a shop item in this guild.');
      }
      const created = await app.prisma.fishingDrop.create({
        data: {
          guildId,
          slug: body.slug,
          name: body.name,
          emoji: body.emoji,
          itemId: body.itemId ?? null,
          minLevel: body.minLevel,
          weight: body.weight,
          currencyMin: body.currencyMin,
          currencyMax: body.currencyMax,
          xpReward: body.xpReward,
          enabled: body.enabled,
        },
      });
      return serializeDrop(created);
    },
  );

  app.delete(
    '/guilds/:guildId/fishing/drops/:id',
    { preHandler: app.requireBot(), schema: { params: DropParams } },
    async (req, reply) => {
      const result = await app.prisma.fishingDrop.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Drop not found.');
      return reply.code(204).send();
    },
  );

  // Seed a freshly-empty guild with the stock drop table. Idempotent at the
  // (guildId, slug) unique level — re-running just skips rows already present.
  app.post(
    '/guilds/:guildId/fishing/drops/seed',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      let inserted = 0;
      for (const row of STOCK_DROPS) {
        const existing = await app.prisma.fishingDrop.findUnique({
          where: { guildId_slug: { guildId, slug: row.slug } },
        });
        if (existing) continue;
        await app.prisma.fishingDrop.create({
          data: {
            guildId,
            slug: row.slug,
            name: row.name,
            emoji: row.emoji,
            minLevel: row.minLevel,
            weight: row.weight,
            currencyMin: row.currencyMin,
            currencyMax: row.currencyMax,
            xpReward: row.xpReward,
          },
        });
        inserted += 1;
      }
      const drops = await app.prisma.fishingDrop.findMany({
        where: { guildId },
        orderBy: [{ minLevel: 'asc' }, { weight: 'desc' }, { slug: 'asc' }],
      });
      return { inserted, total: drops.length, drops: drops.map(serializeDrop) };
    },
  );

  // ── Cast lifecycle ─────────────────────────────────────────────────
  app.post(
    '/guilds/:guildId/fishing/cast',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: z.object({ userId: SnowflakeSchema }) },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId } = req.body;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      // 30s/5min cooldown — refuse if there's still an unresolved cast that
      // started within the stale window. (Anything older has been or will
      // shortly be auto-resolved by the scheduler.)
      const recent = await app.prisma.fishingCast.findFirst({
        where: {
          guildId,
          userId,
          resolved: false,
          startedAt: { gt: new Date(Date.now() - STALE_CAST_WINDOW_MS) },
        },
        orderBy: { startedAt: 'desc' },
      });
      if (recent) {
        throw HttpError.conflict('You already have a line in the water — reel it in first.');
      }

      const now = new Date();
      const cast = await app.prisma.fishingCast.create({
        data: {
          guildId,
          userId,
          startedAt: now,
          resolvesAt: new Date(now.getTime() + CAST_DURATION_MS),
        },
      });
      // Ensure the skill row exists so /fish skill works immediately. Cast
      // count is bumped here (not on resolve) so abandoned casts still count.
      await app.prisma.fishingSkill.upsert({
        where: { guildId_userId: { guildId, userId } },
        create: { guildId, userId, casts: 1 },
        update: { casts: { increment: 1 } },
      });
      return serializeCast(cast);
    },
  );

  // Resolve a single cast. Reusable from both the user-pressed "Reel in"
  // path and the scheduler's auto-resolve sweep — both should return the
  // same CastResult shape.
  async function resolveCastById(guildId: string, castId: string): Promise<CastResult> {
    const cast = await app.prisma.fishingCast.findFirst({
      where: { id: castId, guildId },
    });
    if (!cast) throw HttpError.notFound('Cast not found.');
    if (cast.resolved) {
      // Re-render the previous outcome rather than throwing — the user may
      // have clicked the button twice or the auto-resolver may have already
      // raced through this cast.
      const drop = cast.dropId
        ? await app.prisma.fishingDrop.findUnique({ where: { id: cast.dropId } })
        : null;
      const skill = await app.prisma.fishingSkill.findUnique({
        where: { guildId_userId: { guildId, userId: cast.userId } },
      });
      return {
        cast: serializeCast(cast),
        drop: drop ? serializeDrop(drop) : null,
        skill: serializeSkill(skill, guildId, cast.userId),
        leveledUp: false,
        previousLevel: skill?.level ?? 1,
      };
    }

    const skill = await app.prisma.fishingSkill.findUnique({
      where: { guildId_userId: { guildId, userId: cast.userId } },
    });
    const previousLevel = skill?.level ?? 1;

    // Pick a weighted drop from rows the player has unlocked.
    const eligible = await app.prisma.fishingDrop.findMany({
      where: { guildId, enabled: true, minLevel: { lte: previousLevel } },
    });
    let chosen: PrismaFishingDrop | null = null;
    let currencyAwarded = 0;
    let xpAwarded = 0;
    if (eligible.length > 0) {
      const rng = new SeededRng();
      const idx = weightedPick(rng, eligible.map((d) => d.weight));
      chosen = eligible[idx] ?? null;
      if (chosen) {
        if (chosen.currencyMax > 0 || chosen.currencyMin > 0) {
          currencyAwarded = rng.int(chosen.currencyMin, chosen.currencyMax);
        }
        xpAwarded = chosen.xpReward;
      }
    }

    // Compute the new level by walking the threshold table. We re-derive
    // level from xp+xpAwarded rather than relying on increment, so a fresh
    // FishingSkill row (created lazily here for users who haven't viewed
    // their skill yet) still ends up with the correct level.
    const newXp = (skill?.xp ?? 0) + xpAwarded;
    let newLevel = 1;
    for (let i = 0; i < FISHING_LEVEL_THRESHOLDS.length; i++) {
      if (newXp >= (FISHING_LEVEL_THRESHOLDS[i] ?? 0)) newLevel = i + 1;
    }

    // Apply rewards transactionally.
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    ops.push(
      app.prisma.fishingCast.update({
        where: { id: cast.id },
        data: {
          resolved: true,
          dropId: chosen?.id ?? null,
          currencyEarned: currencyAwarded,
          xpEarned: xpAwarded,
        },
      }),
    );
    ops.push(
      app.prisma.fishingSkill.upsert({
        where: { guildId_userId: { guildId, userId: cast.userId } },
        create: { guildId, userId: cast.userId, xp: xpAwarded, level: newLevel },
        update: { xp: newXp, level: newLevel },
      }),
    );
    if (currencyAwarded > 0) {
      ops.push(
        app.prisma.balance.upsert({
          where: { guildId_userId: { guildId, userId: cast.userId } },
          create: { guildId, userId: cast.userId, amount: currencyAwarded },
          update: { amount: { increment: currencyAwarded } },
        }),
      );
    }
    if (chosen?.itemId) {
      ops.push(
        app.prisma.inventoryEntry.upsert({
          where: {
            guildId_userId_itemId: {
              guildId,
              userId: cast.userId,
              itemId: chosen.itemId,
            },
          },
          create: { guildId, userId: cast.userId, itemId: chosen.itemId, quantity: 1 },
          update: { quantity: { increment: 1 } },
        }),
      );
    }
    await app.prisma.$transaction(ops);

    const updatedCast = await app.prisma.fishingCast.findUniqueOrThrow({
      where: { id: cast.id },
    });
    const updatedSkill = await app.prisma.fishingSkill.findUnique({
      where: { guildId_userId: { guildId, userId: cast.userId } },
    });

    return {
      cast: serializeCast(updatedCast),
      drop: chosen ? serializeDrop(chosen) : null,
      skill: serializeSkill(updatedSkill, guildId, cast.userId),
      leveledUp: newLevel > previousLevel,
      previousLevel,
    };
  }

  app.post(
    '/guilds/:guildId/fishing/resolve',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: z.object({ castId: z.string().uuid() }) },
    },
    async (req) => resolveCastById(req.params.guildId, req.body.castId),
  );

  // Scheduler tick — bulk-resolve every cast whose timer elapsed and which
  // the user hasn't reeled in. Bounded scan so a busy guild doesn't stall
  // the scheduler.
  app.post(
    '/fishing/resolve-due',
    {
      preHandler: app.requireBot(),
      schema: {
        body: z
          .object({ limit: z.number().int().min(1).max(200).default(50) })
          .optional(),
      },
    },
    async (req) => {
      const limit = req.body?.limit ?? 50;
      const due = await app.prisma.fishingCast.findMany({
        where: { resolved: false, resolvesAt: { lte: new Date() } },
        orderBy: { resolvesAt: 'asc' },
        take: limit,
      });
      const results: CastResult[] = [];
      for (const cast of due) {
        try {
          results.push(await resolveCastById(cast.guildId, cast.id));
        } catch (err) {
          req.log.warn({ err, castId: cast.id }, 'fishing auto-resolve failed');
        }
      }
      return { resolved: results.length };
    },
  );
};
