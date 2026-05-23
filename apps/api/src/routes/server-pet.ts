import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import type {
  Prisma,
  ServerPet as PrismaServerPet,
  PetInteraction as PrismaPetInteraction,
} from '@prisma/client';
import { z } from 'zod';
import {
  FeedRequestSchema,
  PetRequestSchema,
  PetStageSchema,
  PlayRequestSchema,
  SnowflakeSchema,
  UpsertPetNameSchema,
  type PetInteractionKind,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });

// XP thresholds for each stage. Mirrors apps/bot/src/util/pet-state.ts; we
// keep the constants in both places so neither side has to round-trip a
// network call to figure out which stage the pet is in.
const STAGE_THRESHOLDS: ReadonlyArray<[string, number]> = [
  ['egg', 0],
  ['baby', 100],
  ['teen', 500],
  ['adult', 2000],
  ['legendary', 10000],
];

function computeStage(xp: number): string {
  let stage = 'egg';
  for (const [name, threshold] of STAGE_THRESHOLDS) {
    if (xp >= threshold) stage = name;
  }
  return stage;
}

const HOUR_MS = 3_600_000;

// Decay applied between `from` and now. Mirrors pet-state.ts so the on-demand
// view matches what the hourly tick would have produced.
function decayPet(pet: PrismaServerPet): {
  hunger: number;
  happiness: number;
  energy: number;
} {
  const elapsedHours = Math.max(0, (Date.now() - pet.lastUpdatedAt.getTime()) / HOUR_MS);
  const hunger = Math.max(0, Math.min(100, pet.hunger - Math.floor(elapsedHours)));
  const happiness = Math.max(0, Math.min(100, pet.happiness - Math.floor(elapsedHours)));
  const energy = Math.max(0, Math.min(100, pet.energy + Math.floor(elapsedHours)));
  return { hunger, happiness, energy };
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function serializePet(p: PrismaServerPet) {
  return {
    guildId: p.guildId,
    name: p.name,
    stage: PetStageSchema.parse(p.stage),
    xp: p.xp,
    hunger: p.hunger,
    happiness: p.happiness,
    energy: p.energy,
    lastUpdatedAt: p.lastUpdatedAt.toISOString(),
  };
}

// Auto-create the pet row on first read so /pet status never 404s.
async function getOrCreatePet(
  app: FastifyInstance,
  guildId: string,
): Promise<PrismaServerPet> {
  const existing = await app.prisma.serverPet.findUnique({ where: { guildId } });
  if (existing) return existing;
  const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) throw HttpError.notFound('Guild not registered.');
  return app.prisma.serverPet.create({ data: { guildId } });
}

interface CooldownConfig {
  kind: PetInteractionKind;
  windowMs: number;
}

async function ensureCooldown(
  app: FastifyInstance,
  guildId: string,
  userId: string,
  cfg: CooldownConfig,
): Promise<void> {
  const since = new Date(Date.now() - cfg.windowMs);
  const last = await app.prisma.petInteraction.findFirst({
    where: { guildId, userId, kind: cfg.kind, at: { gte: since } },
    orderBy: { at: 'desc' },
  });
  if (!last) return;
  const wait = cfg.windowMs - (Date.now() - last.at.getTime());
  if (wait <= 0) return;
  const seconds = Math.ceil(wait / 1000);
  const human =
    seconds >= 3600
      ? `${Math.ceil(seconds / 3600)}h`
      : seconds >= 60
        ? `${Math.ceil(seconds / 60)}m`
        : `${seconds}s`;
  throw HttpError.conflict(`Pet ${cfg.kind} is on cooldown. Try again in ${human}.`);
}

interface InteractionDelta {
  hunger?: number;
  happiness?: number;
  energy?: number;
  xp: number;
}

async function applyInteraction(
  app: FastifyInstance,
  guildId: string,
  userId: string,
  kind: PetInteractionKind,
  delta: InteractionDelta,
  currencySpent = 0,
): Promise<{ pet: PrismaServerPet; xpAwarded: number }> {
  return app.prisma.$transaction(async (tx) => {
    // Re-read inside the transaction so concurrent interactions can't both
    // see a stale 80/80/80 baseline. We also apply decay here so the stored
    // row always reflects "as of now" after every write.
    const current = await tx.serverPet.findUniqueOrThrow({ where: { guildId } });
    const decayed = decayPet(current);
    const newXp = current.xp + delta.xp;
    const stage = computeStage(newXp);
    const data: Prisma.ServerPetUpdateInput = {
      hunger: clamp((delta.hunger !== undefined ? decayed.hunger + delta.hunger : decayed.hunger)),
      happiness: clamp(
        delta.happiness !== undefined ? decayed.happiness + delta.happiness : decayed.happiness,
      ),
      energy: clamp(delta.energy !== undefined ? decayed.energy + delta.energy : decayed.energy),
      xp: newXp,
      stage,
    };
    const pet = await tx.serverPet.update({ where: { guildId }, data });
    await tx.petInteraction.create({
      data: {
        guildId,
        userId,
        kind,
        xpAwarded: delta.xp,
        currencySpent,
      },
    });
    return { pet, xpAwarded: delta.xp };
  });
}

function topFeederEntries(rows: PrismaPetInteraction[]) {
  const tally = new Map<string, { currencySpent: number; interactions: number }>();
  for (const row of rows) {
    const cur = tally.get(row.userId) ?? { currencySpent: 0, interactions: 0 };
    cur.currencySpent += row.currencySpent;
    cur.interactions += 1;
    tally.set(row.userId, cur);
  }
  return [...tally.entries()]
    .map(([userId, t]) => ({ userId, ...t }))
    .sort((a, b) => b.currencySpent - a.currencySpent || b.interactions - a.interactions);
}

export const serverPetRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Read (auto-creates the row on first read) ──────────────────────
  app.get(
    '/guilds/:guildId/server-pet',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const pet = await getOrCreatePet(app, guildId);
      return serializePet(pet);
    },
  );

  // ─── Rename (bot-bearer; the slash-cmd gates ManageGuild itself) ────
  app.patch(
    '/guilds/:guildId/server-pet',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertPetNameSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      // Make sure the row exists before we try to rename it.
      await getOrCreatePet(app, guildId);
      const pet = await app.prisma.serverPet.update({
        where: { guildId },
        data: { name: req.body.name },
      });
      return serializePet(pet);
    },
  );

  // ─── Feed (consumes currency) ───────────────────────────────────────
  app.post(
    '/guilds/:guildId/server-pet/feed',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: FeedRequestSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId, currencySpent } = req.body;

      await getOrCreatePet(app, guildId);
      await ensureCooldown(app, guildId, userId, { kind: 'feed', windowMs: 30 * 1000 });

      const balance = await app.prisma.balance.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      if (!balance || balance.amount < currencySpent) {
        throw HttpError.badRequest('Insufficient balance.');
      }

      // Hunger/happiness/xp gains scale with the spend so feeding a single
      // coin still does something, but the meaningful bumps come from
      // larger gifts. xp = 5 + floor(spend/10), capped at 50.
      const xp = Math.min(50, 5 + Math.floor(currencySpent / 10));
      const hungerGain = Math.min(40, 5 + Math.floor(currencySpent / 5));
      const happinessGain = Math.min(20, 2 + Math.floor(currencySpent / 20));

      const updatedBalance = await app.prisma.balance.update({
        where: { guildId_userId: { guildId, userId } },
        data: { amount: { decrement: currencySpent } },
      });

      const { pet, xpAwarded } = await applyInteraction(
        app,
        guildId,
        userId,
        'feed',
        { hunger: hungerGain, happiness: happinessGain, xp },
        currencySpent,
      );

      return {
        pet: serializePet(pet),
        xpAwarded,
        newBalance: updatedBalance.amount,
      };
    },
  );

  // ─── Play ───────────────────────────────────────────────────────────
  app.post(
    '/guilds/:guildId/server-pet/play',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: PlayRequestSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId } = req.body;

      await getOrCreatePet(app, guildId);
      await ensureCooldown(app, guildId, userId, { kind: 'play', windowMs: 5 * 60 * 1000 });

      const { pet, xpAwarded } = await applyInteraction(
        app,
        guildId,
        userId,
        'play',
        { happiness: 15, energy: -10, xp: 15 },
      );

      return {
        pet: serializePet(pet),
        xpAwarded,
        newBalance: null,
      };
    },
  );

  // ─── Pet (daily) ────────────────────────────────────────────────────
  app.post(
    '/guilds/:guildId/server-pet/pet',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: PetRequestSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId } = req.body;

      await getOrCreatePet(app, guildId);
      await ensureCooldown(app, guildId, userId, { kind: 'pet', windowMs: 24 * 60 * 60 * 1000 });

      const { pet, xpAwarded } = await applyInteraction(
        app,
        guildId,
        userId,
        'pet',
        { happiness: 5, xp: 5 },
      );

      return {
        pet: serializePet(pet),
        xpAwarded,
        newBalance: null,
      };
    },
  );

  // ─── Top feeder (last 24h) ──────────────────────────────────────────
  app.get(
    '/guilds/:guildId/server-pet/top-feeder',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(5),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await app.prisma.petInteraction.findMany({
        where: { guildId, kind: 'feed', at: { gte: since } },
      });
      const entries = topFeederEntries(rows).slice(0, req.query.limit);
      return { guildId, entries };
    },
  );

  // ─── Hourly decay tick (bot-bearer) ─────────────────────────────────
  // Iterates every server pet and re-bases its stat block to "as of now"
  // using the same decay curve the on-demand reads use. Idempotent.
  app.post(
    '/server-pet/tick/decay',
    {
      preHandler: app.requireBot(),
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(5000).default(1000),
        }),
      },
    },
    async (req) => {
      const pets = await app.prisma.serverPet.findMany({ take: req.query.limit });
      let updated = 0;
      for (const pet of pets) {
        const decayed = decayPet(pet);
        if (
          decayed.hunger === pet.hunger &&
          decayed.happiness === pet.happiness &&
          decayed.energy === pet.energy
        ) {
          continue;
        }
        await app.prisma.serverPet.update({
          where: { guildId: pet.guildId },
          data: {
            hunger: decayed.hunger,
            happiness: decayed.happiness,
            energy: decayed.energy,
          },
        });
        updated += 1;
      }
      return { scanned: pets.length, updated };
    },
  );
};
