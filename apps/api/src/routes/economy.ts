import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Balance, EconomyConfig, InventoryEntry, ShopItem } from '@prisma/client';
import { z } from 'zod';
import {
  CreateShopItemSchema,
  SnowflakeSchema,
  ShopItemKindSchema,
  UpdateEconomyConfigSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const UserParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });
const ItemParams = z.object({ guildId: SnowflakeSchema, itemId: z.string().uuid() });

function serializeConfig(guildId: string, cfg: EconomyConfig | null) {
  return {
    guildId,
    enabled: cfg?.enabled ?? false,
    currencyName: cfg?.currencyName ?? 'coins',
    currencySymbol: cfg?.currencySymbol ?? '🪙',
    startingBalance: cfg?.startingBalance ?? 0,
    dailyReward: cfg?.dailyReward ?? 100,
    dailyCooldownSeconds: cfg?.dailyCooldownSeconds ?? 86_400,
    workMin: cfg?.workMin ?? 20,
    workMax: cfg?.workMax ?? 80,
    workCooldownSeconds: cfg?.workCooldownSeconds ?? 3600,
    gamblingEnabled: cfg?.gamblingEnabled ?? true,
  };
}

function serializeBalance(b: Balance | null, guildId: string, userId: string) {
  return {
    guildId,
    userId,
    amount: b?.amount ?? 0,
    lastDailyAt: b?.lastDailyAt?.toISOString() ?? null,
    lastWorkAt: b?.lastWorkAt?.toISOString() ?? null,
  };
}

function serializeShopItem(s: ShopItem) {
  // Existing /shop callers still want the legacy kind union; we narrow the new
  // expanded set down on the wire so old clients keep type-checking. The new
  // shop endpoints (/shop-items) return the full kind set.
  const legacyKind: 'virtual' | 'role' =
    s.kind === 'role' ? 'role' : 'virtual';
  return {
    id: s.id,
    guildId: s.guildId,
    name: s.name,
    description: s.description,
    price: s.price,
    kind: legacyKind,
    roleId: s.roleId,
    stock: s.stock,
    createdAt: s.createdAt.toISOString(),
  };
}

function serializeInventory(entry: InventoryEntry & { item: ShopItem | null }) {
  return {
    // The composite-keyed InventoryEntry no longer has its own id; we expose a
    // stable derived "id" so existing clients keep working.
    id: `${entry.guildId}:${entry.userId}:${entry.itemId}`,
    guildId: entry.guildId,
    userId: entry.userId,
    itemId: entry.itemId,
    quantity: entry.quantity,
    createdAt: entry.acquiredAt.toISOString(),
    item: entry.item ? serializeShopItem(entry.item) : undefined,
  };
}

export const economyRoutes: FastifyPluginAsyncZod = async (app) => {
  // Config
  app.get(
    '/guilds/:guildId/economy-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.economyConfig.findUnique({ where: { guildId } });
      return serializeConfig(guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/economy-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpdateEconomyConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      for (const k of [
        'enabled',
        'currencyName',
        'currencySymbol',
        'startingBalance',
        'dailyReward',
        'dailyCooldownSeconds',
        'workMin',
        'workMax',
        'workCooldownSeconds',
        'gamblingEnabled',
      ] as const) {
        const v = (patch as Record<string, unknown>)[k];
        if (v !== undefined) update[k] = v;
      }
      const cfg = await app.prisma.economyConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          currencyName: patch.currencyName ?? 'coins',
          currencySymbol: patch.currencySymbol ?? '🪙',
          startingBalance: patch.startingBalance ?? 0,
          dailyReward: patch.dailyReward ?? 100,
          dailyCooldownSeconds: patch.dailyCooldownSeconds ?? 86_400,
          workMin: patch.workMin ?? 20,
          workMax: patch.workMax ?? 80,
          workCooldownSeconds: patch.workCooldownSeconds ?? 3600,
          gamblingEnabled: patch.gamblingEnabled ?? true,
        },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  // Balance
  app.get(
    '/guilds/:guildId/balance/:userId',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const b = await app.prisma.balance.findUnique({ where: { guildId_userId: { guildId, userId } } });
      return serializeBalance(b, guildId, userId);
    },
  );

  app.post(
    '/guilds/:guildId/balance/:userId/daily',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const cfg = await app.prisma.economyConfig.findUnique({ where: { guildId } });
      if (!cfg?.enabled) throw HttpError.conflict('Economy not enabled in this guild.');
      const existing = await app.prisma.balance.findUnique({ where: { guildId_userId: { guildId, userId } } });
      if (existing?.lastDailyAt) {
        const since = Date.now() - existing.lastDailyAt.getTime();
        if (since < cfg.dailyCooldownSeconds * 1000) {
          const wait = cfg.dailyCooldownSeconds * 1000 - since;
          throw HttpError.conflict(`Daily already claimed. Try again in ${Math.ceil(wait / 60_000)} minutes.`);
        }
      }
      const reward = cfg.dailyReward;
      const updated = await app.prisma.balance.upsert({
        where: { guildId_userId: { guildId, userId } },
        update: { amount: { increment: reward }, lastDailyAt: new Date() },
        create: { guildId, userId, amount: cfg.startingBalance + reward, lastDailyAt: new Date() },
      });
      return { ...serializeBalance(updated, guildId, userId), reward };
    },
  );

  app.post(
    '/guilds/:guildId/balance/:userId/work',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const cfg = await app.prisma.economyConfig.findUnique({ where: { guildId } });
      if (!cfg?.enabled) throw HttpError.conflict('Economy not enabled in this guild.');
      const existing = await app.prisma.balance.findUnique({ where: { guildId_userId: { guildId, userId } } });
      if (existing?.lastWorkAt && cfg.workCooldownSeconds > 0) {
        const since = Date.now() - existing.lastWorkAt.getTime();
        if (since < cfg.workCooldownSeconds * 1000) {
          const wait = cfg.workCooldownSeconds * 1000 - since;
          throw HttpError.conflict(`You're too tired. Try again in ${Math.ceil(wait / 60_000)} minutes.`);
        }
      }
      const reward =
        Math.floor(Math.random() * Math.max(1, cfg.workMax - cfg.workMin + 1)) + cfg.workMin;
      const updated = await app.prisma.balance.upsert({
        where: { guildId_userId: { guildId, userId } },
        update: { amount: { increment: reward }, lastWorkAt: new Date() },
        create: { guildId, userId, amount: cfg.startingBalance + reward, lastWorkAt: new Date() },
      });
      return { ...serializeBalance(updated, guildId, userId), reward };
    },
  );

  app.post(
    '/guilds/:guildId/balance/:userId/transfer',
    {
      preHandler: app.requireBot(),
      schema: {
        params: UserParams,
        body: z.object({ toUserId: SnowflakeSchema, amount: z.number().int().positive() }),
      },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const { toUserId, amount } = req.body;
      if (userId === toUserId) throw HttpError.badRequest('Cannot transfer to yourself.');
      const from = await app.prisma.balance.findUnique({ where: { guildId_userId: { guildId, userId } } });
      if (!from || from.amount < amount) throw HttpError.badRequest('Insufficient balance.');
      await app.prisma.$transaction([
        app.prisma.balance.update({
          where: { guildId_userId: { guildId, userId } },
          data: { amount: { decrement: amount } },
        }),
        app.prisma.balance.upsert({
          where: { guildId_userId: { guildId, userId: toUserId } },
          update: { amount: { increment: amount } },
          create: { guildId, userId: toUserId, amount },
        }),
      ]);
      return { ok: true, amount };
    },
  );

  app.post(
    '/guilds/:guildId/balance/:userId/adjust',
    {
      preHandler: app.requireBot(),
      schema: { params: UserParams, body: z.object({ delta: z.number().int() }) },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const { delta } = req.body;
      const updated = await app.prisma.balance.upsert({
        where: { guildId_userId: { guildId, userId } },
        update: { amount: { increment: delta } },
        create: { guildId, userId, amount: Math.max(0, delta) },
      });
      return serializeBalance(updated, guildId, userId);
    },
  );

  // Gambling
  app.post(
    '/guilds/:guildId/balance/:userId/gamble',
    {
      preHandler: app.requireBot(),
      schema: {
        params: UserParams,
        body: z.object({
          stake: z.number().int().positive(),
          game: z.enum(['coinflip', 'slots']),
        }),
      },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const { stake, game } = req.body;
      const cfg = await app.prisma.economyConfig.findUnique({ where: { guildId } });
      if (!cfg?.enabled || !cfg.gamblingEnabled) {
        throw HttpError.conflict('Gambling is disabled in this guild.');
      }
      const existing = await app.prisma.balance.findUnique({ where: { guildId_userId: { guildId, userId } } });
      if (!existing || existing.amount < stake) throw HttpError.badRequest('Insufficient balance.');

      let delta = 0;
      const result: Record<string, unknown> = {};
      if (game === 'coinflip') {
        const win = Math.random() < 0.5;
        delta = win ? stake : -stake;
        result.outcome = win ? 'heads' : 'tails';
        result.win = win;
      } else {
        // Slots: 3 reels, 6 symbols. Two matches → 2x, three matches → 6x.
        const symbols = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'];
        const reels = [
          symbols[Math.floor(Math.random() * symbols.length)]!,
          symbols[Math.floor(Math.random() * symbols.length)]!,
          symbols[Math.floor(Math.random() * symbols.length)]!,
        ];
        const allMatch = reels[0] === reels[1] && reels[1] === reels[2];
        const twoMatch =
          !allMatch && (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]);
        const multiplier = allMatch ? 6 : twoMatch ? 2 : 0;
        delta = multiplier === 0 ? -stake : stake * (multiplier - 1);
        result.reels = reels;
        result.multiplier = multiplier;
      }

      const updated = await app.prisma.balance.update({
        where: { guildId_userId: { guildId, userId } },
        data: { amount: { increment: delta } },
      });
      return { ...serializeBalance(updated, guildId, userId), delta, game, ...result };
    },
  );

  app.get(
    '/guilds/:guildId/economy-leaderboard',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const top = await app.prisma.balance.findMany({
        where: { guildId },
        orderBy: { amount: 'desc' },
        take: req.query.limit,
      });
      return {
        entries: top.map((b, i) => ({
          rank: i + 1,
          guildId,
          userId: b.userId,
          amount: b.amount,
        })),
      };
    },
  );

  // Shop
  app.get(
    '/guilds/:guildId/shop',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.shopItem.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { price: 'asc' },
      });
      return { items: items.map(serializeShopItem) };
    },
  );

  app.post(
    '/guilds/:guildId/shop',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateShopItemSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      // Derive a slug from the name; the new shop-items endpoint accepts an
      // explicit slug, but the legacy endpoint only takes a name.
      const slugBase =
        req.body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48) || `item-${Date.now().toString(36)}`;
      let slug = slugBase;
      let i = 1;
      while (await app.prisma.shopItem.findUnique({ where: { guildId_slug: { guildId, slug } } })) {
        slug = `${slugBase}-${i++}`.slice(0, 48);
      }
      const item = await app.prisma.shopItem.create({
        data: {
          guildId,
          slug,
          name: req.body.name,
          description: req.body.description ?? null,
          price: req.body.price,
          kind: req.body.kind,
          roleId: req.body.roleId ?? null,
          stock: req.body.stock ?? null,
        },
      });
      return serializeShopItem(item);
    },
  );

  app.delete(
    '/guilds/:guildId/shop/:itemId',
    { preHandler: app.requireBot(), schema: { params: ItemParams } },
    async (req, reply) => {
      const result = await app.prisma.shopItem.deleteMany({
        where: { id: req.params.itemId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Item not found.');
      return reply.code(204).send();
    },
  );

  app.post(
    '/guilds/:guildId/shop/:itemId/buy',
    {
      preHandler: app.requireBot(),
      schema: { params: ItemParams, body: z.object({ userId: SnowflakeSchema }) },
    },
    async (req) => {
      const { guildId, itemId } = req.params;
      const { userId } = req.body;
      const item = await app.prisma.shopItem.findFirst({ where: { id: itemId, guildId } });
      if (!item) throw HttpError.notFound('Item not found.');
      if (item.stock !== null && item.stock <= 0) throw HttpError.conflict('Item out of stock.');

      const balance = await app.prisma.balance.findUnique({ where: { guildId_userId: { guildId, userId } } });
      if (!balance || balance.amount < item.price) throw HttpError.badRequest('Insufficient balance.');

      const [, updatedBalance, entry] = await app.prisma.$transaction([
        app.prisma.shopItem.update({
          where: { id: itemId },
          data: item.stock !== null ? { stock: { decrement: 1 } } : {},
        }),
        app.prisma.balance.update({
          where: { guildId_userId: { guildId, userId } },
          data: { amount: { decrement: item.price } },
        }),
        app.prisma.inventoryEntry.upsert({
          where: {
            guildId_userId_itemId: { guildId, userId, itemId },
          },
          create: { guildId, userId, itemId, quantity: 1 },
          update: { quantity: { increment: 1 } },
          include: { item: true },
        }),
      ]);

      return {
        item: serializeShopItem(item),
        balance: serializeBalance(updatedBalance, guildId, userId),
        inventoryEntry: serializeInventory(entry),
      };
    },
  );

  app.get(
    '/guilds/:guildId/inventory/:userId',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const entries = await app.prisma.inventoryEntry.findMany({
        where: { guildId, userId },
        include: { item: true },
        orderBy: { acquiredAt: 'desc' },
      });
      return { entries: entries.map(serializeInventory) };
    },
  );

  // Side-effect: re-export the ShopItemKindSchema so future routes pick it up.
  void ShopItemKindSchema;
};
