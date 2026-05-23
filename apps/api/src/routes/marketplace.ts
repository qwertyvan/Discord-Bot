import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  MarketListing as PrismaMarketListing,
  MarketConfig as PrismaMarketConfig,
  ShopItem as PrismaShopItem,
} from '@prisma/client';
import { z } from 'zod';
import {
  BuyListingSchema,
  CancelListingSchema,
  CreateListingSchema,
  ListingFilterSchema,
  MarketListingStatusSchema,
  ShopItemKindExtSchema,
  SnowflakeSchema,
  UpsertMarketConfigSchema,
  type MarketConfig,
  type MarketListing,
  type MarketListingStatus,
  type ShopItemExt,
  type ShopItemKindExt,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ListingParams = z.object({
  guildId: SnowflakeSchema,
  id: z.string().uuid(),
});

// Listings live for 7 days. The scheduler's hourly tick sweeps any rows
// past `expiresAt` and refunds escrow to the seller's inventory.
const LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function serializeListing(
  l: PrismaMarketListing & { item?: PrismaShopItem | null },
): MarketListing {
  const statusParsed = MarketListingStatusSchema.safeParse(l.status);
  const status: MarketListingStatus = statusParsed.success
    ? statusParsed.data
    : 'active';
  return {
    id: l.id,
    guildId: l.guildId,
    sellerId: l.sellerId,
    itemId: l.itemId,
    quantity: l.quantity,
    priceCents: l.priceCents,
    listedAt: l.listedAt.toISOString(),
    expiresAt: l.expiresAt.toISOString(),
    status,
    buyerId: l.buyerId,
    completedAt: l.completedAt?.toISOString() ?? null,
    ...(l.item ? { item: serializeItem(l.item) } : {}),
  };
}

function serializeConfig(c: PrismaMarketConfig): MarketConfig {
  return {
    guildId: c.guildId,
    enabled: c.enabled,
    minTenureDays: c.minTenureDays,
    maxActiveListingsPerUser: c.maxActiveListingsPerUser,
  };
}

const DEFAULT_CONFIG = {
  enabled: true,
  minTenureDays: 1,
  maxActiveListingsPerUser: 10,
} as const;

export const marketplaceRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Config ────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/marketplace-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const existing = await app.prisma.marketConfig.findUnique({
        where: { guildId },
      });
      if (existing) return serializeConfig(existing);
      return {
        guildId,
        ...DEFAULT_CONFIG,
      } satisfies MarketConfig;
    },
  );

  app.put(
    '/guilds/:guildId/marketplace-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertMarketConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const body = req.body;
      const cfg = await app.prisma.marketConfig.upsert({
        where: { guildId },
        create: {
          guildId,
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.minTenureDays !== undefined
            ? { minTenureDays: body.minTenureDays }
            : {}),
          ...(body.maxActiveListingsPerUser !== undefined
            ? { maxActiveListingsPerUser: body.maxActiveListingsPerUser }
            : {}),
        },
        update: {
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.minTenureDays !== undefined
            ? { minTenureDays: body.minTenureDays }
            : {}),
          ...(body.maxActiveListingsPerUser !== undefined
            ? { maxActiveListingsPerUser: body.maxActiveListingsPerUser }
            : {}),
        },
      });
      return serializeConfig(cfg);
    },
  );

  // ── Listings ──────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/listings',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, querystring: ListingFilterSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { status, sellerId, itemSlug, limit } = req.query;
      const rows = await app.prisma.marketListing.findMany({
        where: {
          guildId,
          ...(status ? { status } : {}),
          ...(sellerId ? { sellerId } : {}),
          ...(itemSlug ? { item: { slug: itemSlug } } : {}),
        },
        include: { item: true },
        orderBy: { listedAt: 'desc' },
        take: limit,
      });
      return { listings: rows.map((r) => serializeListing(r)) };
    },
  );

  app.get(
    '/guilds/:guildId/listings/:id',
    { preHandler: app.requireBot(), schema: { params: ListingParams } },
    async (req) => {
      const row = await app.prisma.marketListing.findFirst({
        where: { id: req.params.id, guildId: req.params.guildId },
        include: { item: true },
      });
      if (!row) throw HttpError.notFound('Listing not found.');
      return serializeListing(row);
    },
  );

  // Create — moves N units of the seller's inventory into escrow on the
  // listing row. Enforces marketplace enabled, per-user cap, and tenure.
  app.post(
    '/guilds/:guildId/listings',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateListingSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { sellerId, itemId, quantity, priceCents, sellerJoinedAt } = req.body;

      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      // Resolve effective config (falls back to defaults when no row exists).
      const cfgRow = await app.prisma.marketConfig.findUnique({
        where: { guildId },
      });
      const cfg = cfgRow ?? { guildId, ...DEFAULT_CONFIG };
      if (!cfg.enabled) {
        throw HttpError.conflict('Marketplace is disabled in this server.');
      }

      const joinedAt = new Date(sellerJoinedAt);
      if (Number.isNaN(joinedAt.getTime())) {
        throw HttpError.badRequest('Invalid sellerJoinedAt.');
      }
      const ageMs = Date.now() - joinedAt.getTime();
      const minMs = cfg.minTenureDays * 24 * 60 * 60 * 1000;
      if (ageMs < minMs) {
        throw HttpError.forbidden(
          `You must be in this server for at least ${cfg.minTenureDays} day(s) to list items.`,
        );
      }

      const activeCount = await app.prisma.marketListing.count({
        where: { guildId, sellerId, status: 'active' },
      });
      if (activeCount >= cfg.maxActiveListingsPerUser) {
        throw HttpError.conflict(
          `You already have ${activeCount} active listings (cap: ${cfg.maxActiveListingsPerUser}).`,
        );
      }

      const inv = await app.prisma.inventoryEntry.findUnique({
        where: { guildId_userId_itemId: { guildId, userId: sellerId, itemId } },
        include: { item: true },
      });
      if (!inv || inv.quantity < quantity) {
        throw HttpError.badRequest('You do not own enough of that item.');
      }
      if (!inv.item) throw HttpError.notFound('Item no longer exists.');

      const now = new Date();
      const expiresAt = new Date(now.getTime() + LISTING_TTL_MS);

      // Atomic: debit seller inventory into escrow + create the listing row.
      const [, created] = await app.prisma.$transaction([
        app.prisma.inventoryEntry.update({
          where: {
            guildId_userId_itemId: { guildId, userId: sellerId, itemId },
          },
          data: { quantity: { decrement: quantity } },
        }),
        app.prisma.marketListing.create({
          data: {
            guildId,
            sellerId,
            itemId,
            quantity,
            priceCents,
            expiresAt,
          },
          include: { item: true },
        }),
      ]);
      return serializeListing(created);
    },
  );

  // Buy — single transaction: debit buyer balance, credit seller balance,
  // transfer escrow units to the buyer's inventory, mark listing sold.
  app.post(
    '/guilds/:guildId/listings/:id/buy',
    {
      preHandler: app.requireBot(),
      schema: { params: ListingParams, body: BuyListingSchema },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const { buyerId } = req.body;

      const listing = await app.prisma.marketListing.findFirst({
        where: { id, guildId },
        include: { item: true },
      });
      if (!listing) throw HttpError.notFound('Listing not found.');
      if (listing.status !== 'active') {
        throw HttpError.conflict(`Listing is ${listing.status}.`);
      }
      if (listing.expiresAt.getTime() <= Date.now()) {
        throw HttpError.conflict('Listing has expired.');
      }
      if (listing.sellerId === buyerId) {
        throw HttpError.badRequest('You cannot buy your own listing.');
      }
      if (!listing.item) throw HttpError.notFound('Item no longer exists.');

      const buyerBal = await app.prisma.balance.findUnique({
        where: { guildId_userId: { guildId, userId: buyerId } },
      });
      if (!buyerBal || buyerBal.amount < listing.priceCents) {
        throw HttpError.badRequest('Insufficient balance.');
      }

      const now = new Date();
      const [, , , sold] = await app.prisma.$transaction([
        app.prisma.balance.update({
          where: { guildId_userId: { guildId, userId: buyerId } },
          data: { amount: { decrement: listing.priceCents } },
        }),
        app.prisma.balance.upsert({
          where: { guildId_userId: { guildId, userId: listing.sellerId } },
          create: {
            guildId,
            userId: listing.sellerId,
            amount: listing.priceCents,
          },
          update: { amount: { increment: listing.priceCents } },
        }),
        app.prisma.inventoryEntry.upsert({
          where: {
            guildId_userId_itemId: {
              guildId,
              userId: buyerId,
              itemId: listing.itemId,
            },
          },
          create: {
            guildId,
            userId: buyerId,
            itemId: listing.itemId,
            quantity: listing.quantity,
          },
          update: { quantity: { increment: listing.quantity } },
        }),
        app.prisma.marketListing.update({
          where: { id },
          data: { status: 'sold', buyerId, completedAt: now },
          include: { item: true },
        }),
      ]);
      return serializeListing(sold);
    },
  );

  // Cancel — seller (or admin via dashboard) reclaims the escrow units.
  app.post(
    '/guilds/:guildId/listings/:id/cancel',
    {
      preHandler: app.requireBot(),
      schema: { params: ListingParams, body: CancelListingSchema },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const { requesterId } = req.body;

      const listing = await app.prisma.marketListing.findFirst({
        where: { id, guildId },
        include: { item: true },
      });
      if (!listing) throw HttpError.notFound('Listing not found.');
      if (listing.status !== 'active') {
        throw HttpError.conflict(`Listing is already ${listing.status}.`);
      }
      if (listing.sellerId !== requesterId) {
        throw HttpError.forbidden('Only the seller can cancel this listing.');
      }

      const now = new Date();
      const [, cancelled] = await app.prisma.$transaction([
        app.prisma.inventoryEntry.upsert({
          where: {
            guildId_userId_itemId: {
              guildId,
              userId: listing.sellerId,
              itemId: listing.itemId,
            },
          },
          create: {
            guildId,
            userId: listing.sellerId,
            itemId: listing.itemId,
            quantity: listing.quantity,
          },
          update: { quantity: { increment: listing.quantity } },
        }),
        app.prisma.marketListing.update({
          where: { id },
          data: { status: 'cancelled', completedAt: now },
          include: { item: true },
        }),
      ]);
      return serializeListing(cancelled);
    },
  );

  // Sweep — called by the bot's hourly tick. Returns escrow units for every
  // active listing past its expiry window and marks them 'expired'. Idempotent.
  app.post(
    '/marketplace/sweep-expired',
    { preHandler: app.requireBot() },
    async () => {
      const due = await app.prisma.marketListing.findMany({
        where: { status: 'active', expiresAt: { lte: new Date() } },
        take: 200,
      });
      const expired: MarketListing[] = [];
      for (const l of due) {
        const now = new Date();
        const [, updated] = await app.prisma.$transaction([
          app.prisma.inventoryEntry.upsert({
            where: {
              guildId_userId_itemId: {
                guildId: l.guildId,
                userId: l.sellerId,
                itemId: l.itemId,
              },
            },
            create: {
              guildId: l.guildId,
              userId: l.sellerId,
              itemId: l.itemId,
              quantity: l.quantity,
            },
            update: { quantity: { increment: l.quantity } },
          }),
          app.prisma.marketListing.update({
            where: { id: l.id },
            data: { status: 'expired', completedAt: now },
            include: { item: true },
          }),
        ]);
        expired.push(serializeListing(updated));
      }
      return { expired };
    },
  );
};
