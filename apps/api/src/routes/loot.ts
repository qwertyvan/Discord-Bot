import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  LootDrop as PrismaLootDrop,
  ShopItem as PrismaShopItem,
} from '@prisma/client';
import { z } from 'zod';
import {
  ShopItemKindExtSchema,
  SnowflakeSchema,
  UpsertLootDropSchema,
  type LootClaimResult,
  type LootDrop,
  type ShopItemExt,
  type ShopItemKindExt,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { SeededRng, weightedPick } from '../util/game-engines.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const DropParams = z.object({
  guildId: SnowflakeSchema,
  id: z.string().uuid(),
});

function serializeItem(s: PrismaShopItem): ShopItemExt {
  const rawKind = s.kind === 'virtual' ? 'consumable' : s.kind;
  const parsed = ShopItemKindExtSchema.safeParse(rawKind);
  const kind: ShopItemKindExt = parsed.success ? parsed.data : 'consumable';
  return {
    id: s.id,
    guildId: s.guildId,
    slug: s.slug,
    name: s.name,
    description: s.description,
    priceCents: s.price,
    stock: s.stock,
    kind,
    roleId: s.roleId,
    message: s.message,
    enabled: s.enabled,
    createdAt: s.createdAt.toISOString(),
  };
}

function serializeDrop(
  d: PrismaLootDrop & { item: PrismaShopItem | null },
): LootDrop {
  return {
    id: d.id,
    guildId: d.guildId,
    slug: d.slug,
    itemId: d.itemId,
    currencyMin: d.currencyMin,
    currencyMax: d.currencyMax,
    weight: d.weight,
    item: d.item ? serializeItem(d.item) : null,
  };
}

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Streak resets if more than 48h passes since the last claim. Two missed
// 24h windows = streak broken.
const STREAK_GRACE_MS = 48 * 60 * 60 * 1000;

export const lootRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/loot-drops',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const drops = await app.prisma.lootDrop.findMany({
        where: { guildId: req.params.guildId },
        include: { item: true },
        orderBy: [{ weight: 'desc' }, { slug: 'asc' }],
      });
      return { drops: drops.map(serializeDrop) };
    },
  );

  app.post(
    '/guilds/:guildId/loot-drops',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertLootDropSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const body = req.body;
      if (body.currencyMax < body.currencyMin) {
        throw HttpError.badRequest('currencyMax must be >= currencyMin.');
      }
      if (!body.itemId && body.currencyMax === 0 && body.currencyMin === 0) {
        throw HttpError.badRequest('Drop must award either an item or some currency.');
      }
      const created = await app.prisma.lootDrop.create({
        data: {
          guildId,
          slug: body.slug,
          itemId: body.itemId ?? null,
          currencyMin: body.currencyMin,
          currencyMax: body.currencyMax,
          weight: body.weight,
        },
        include: { item: true },
      });
      return serializeDrop(created);
    },
  );

  app.patch(
    '/guilds/:guildId/loot-drops/:id',
    {
      preHandler: app.requireBot(),
      schema: { params: DropParams, body: UpsertLootDropSchema.partial() },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const existing = await app.prisma.lootDrop.findFirst({ where: { id, guildId } });
      if (!existing) throw HttpError.notFound('Drop not found.');
      const body = req.body;
      const update: Record<string, unknown> = {};
      if (body.slug !== undefined) update.slug = body.slug;
      if (body.itemId !== undefined) update.itemId = body.itemId;
      if (body.currencyMin !== undefined) update.currencyMin = body.currencyMin;
      if (body.currencyMax !== undefined) update.currencyMax = body.currencyMax;
      if (body.weight !== undefined) update.weight = body.weight;
      const updated = await app.prisma.lootDrop.update({
        where: { id },
        data: update,
        include: { item: true },
      });
      return serializeDrop(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/loot-drops/:id',
    { preHandler: app.requireBot(), schema: { params: DropParams } },
    async (req, reply) => {
      const result = await app.prisma.lootDrop.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Drop not found.');
      return reply.code(204).send();
    },
  );

  // Daily crate claim. Cooldown is 24h since last claim. Streak rolls over
  // for claims that come within a 48h grace window.
  app.post(
    '/guilds/:guildId/loot-claims/claim',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        body: z.object({ userId: SnowflakeSchema }),
      },
    },
    async (req): Promise<LootClaimResult> => {
      const { guildId } = req.params;
      const { userId } = req.body;

      const claim = await app.prisma.lootClaim.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      const now = Date.now();
      if (claim?.lastClaimAt) {
        const since = now - claim.lastClaimAt.getTime();
        if (since < DAILY_COOLDOWN_MS) {
          const wait = DAILY_COOLDOWN_MS - since;
          throw HttpError.conflict(
            `Crate not ready yet. Try again in ${Math.ceil(wait / 60_000)} minutes.`,
          );
        }
      }

      const drops = await app.prisma.lootDrop.findMany({
        where: { guildId },
        include: { item: true },
      });
      if (drops.length === 0) {
        throw HttpError.conflict('No loot drops are configured in this guild.');
      }

      const rng = new SeededRng();
      const idx = weightedPick(
        rng,
        drops.map((d) => d.weight),
      );
      const chosen = drops[idx]!;

      let currencyAwarded = 0;
      if (chosen.currencyMax > 0 || chosen.currencyMin > 0) {
        currencyAwarded = rng.int(chosen.currencyMin, chosen.currencyMax);
      }

      const newStreak =
        claim?.lastClaimAt && now - claim.lastClaimAt.getTime() <= STREAK_GRACE_MS
          ? (claim.streak ?? 0) + 1
          : 1;

      // Apply rewards transactionally so a partial failure doesn't grant
      // currency without the inventory entry (or vice-versa).
      const ops = [];
      if (currencyAwarded > 0) {
        ops.push(
          app.prisma.balance.upsert({
            where: { guildId_userId: { guildId, userId } },
            create: { guildId, userId, amount: currencyAwarded },
            update: { amount: { increment: currencyAwarded } },
          }),
        );
      }
      if (chosen.itemId) {
        ops.push(
          app.prisma.inventoryEntry.upsert({
            where: {
              guildId_userId_itemId: { guildId, userId, itemId: chosen.itemId },
            },
            create: { guildId, userId, itemId: chosen.itemId, quantity: 1 },
            update: { quantity: { increment: 1 } },
          }),
        );
      }
      ops.push(
        app.prisma.lootClaim.upsert({
          where: { guildId_userId: { guildId, userId } },
          create: {
            guildId,
            userId,
            lastClaimAt: new Date(now),
            streak: newStreak,
          },
          update: { lastClaimAt: new Date(now), streak: newStreak },
        }),
      );
      await app.prisma.$transaction(ops);

      // Read back the running balance for the response payload.
      const balance = await app.prisma.balance.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });

      return {
        drop: serializeDrop(chosen),
        currencyAwarded,
        itemAwarded: chosen.item ? serializeItem(chosen.item) : null,
        balance: balance?.amount ?? 0,
        streak: newStreak,
        nextClaimAt: new Date(now + DAILY_COOLDOWN_MS).toISOString(),
      };
    },
  );
};
