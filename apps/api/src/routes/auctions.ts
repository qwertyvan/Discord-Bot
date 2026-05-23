import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  Auction as PrismaAuction,
  AuctionBid as PrismaAuctionBid,
  ShopItem as PrismaShopItem,
} from '@prisma/client';
import { z } from 'zod';
import {
  AuctionStatusSchema,
  CancelAuctionSchema,
  CreateAuctionSchema,
  PlaceBidSchema,
  SnowflakeSchema,
  type Auction,
  type AuctionBid,
  type AuctionStatus,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const AuctionParams = z.object({
  guildId: SnowflakeSchema,
  auctionId: z.string().uuid(),
});

// Anti-snipe window: a bid landing within this many ms of endsAt extends
// endsAt by the same amount.
const ANTI_SNIPE_WINDOW_MS = 60_000;

type AuctionWithRels = PrismaAuction & {
  item: PrismaShopItem | null;
  bids?: PrismaAuctionBid[];
  _count?: { bids: number };
};

function serializeBid(b: PrismaAuctionBid): AuctionBid {
  return {
    id: b.id,
    auctionId: b.auctionId,
    userId: b.userId,
    amountCents: b.amountCents,
    escrowedCents: b.escrowedCents,
    placedAt: b.placedAt.toISOString(),
    refundedAt: b.refundedAt ? b.refundedAt.toISOString() : null,
  };
}

function serializeAuction(
  a: AuctionWithRels,
  opts: { includeBids?: boolean } = {},
): Auction {
  const bidCount = a._count?.bids ?? a.bids?.length ?? 0;
  const base: Auction = {
    id: a.id,
    guildId: a.guildId,
    sellerId: a.sellerId,
    itemId: a.itemId,
    quantity: a.quantity,
    startPriceCents: a.startPriceCents,
    minIncrementCents: a.minIncrementCents,
    currentBidCents: a.currentBidCents,
    currentBidderId: a.currentBidderId,
    endsAt: a.endsAt.toISOString(),
    status: a.status as AuctionStatus,
    createdAt: a.createdAt.toISOString(),
    settledAt: a.settledAt ? a.settledAt.toISOString() : null,
    bidCount,
    itemName: a.item?.name ?? null,
    itemSlug: a.item?.slug ?? null,
  };
  if (opts.includeBids && a.bids) {
    return { ...base, bids: a.bids.map(serializeBid) };
  }
  return base;
}

export const auctionsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Due (bot-bearer) — auctions past endsAt still active ────────────
  app.post(
    '/auctions/due',
    {
      preHandler: app.requireBot(),
      schema: {
        body: z
          .object({ limit: z.number().int().min(1).max(100).default(50) })
          .default({ limit: 50 }),
      },
    },
    async (req) => {
      const limit = req.body?.limit ?? 50;
      const due = await app.prisma.auction.findMany({
        where: { status: 'active', endsAt: { lte: new Date() } },
        include: { item: true, _count: { select: { bids: true } } },
        take: limit,
      });
      return { auctions: due.map((a) => serializeAuction(a)) };
    },
  );

  // ─── List (bot-bearer) ───────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/auctions',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          status: AuctionStatusSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const auctions = await app.prisma.auction.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        include: { item: true, _count: { select: { bids: true } } },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { auctions: auctions.map((a) => serializeAuction(a)) };
    },
  );

  // ─── Get one (bot-bearer) — includes last 10 bids ────────────────────
  app.get(
    '/guilds/:guildId/auctions/:auctionId',
    {
      preHandler: app.requireBot(),
      schema: { params: AuctionParams },
    },
    async (req) => {
      const a = await app.prisma.auction.findFirst({
        where: { id: req.params.auctionId, guildId: req.params.guildId },
        include: {
          item: true,
          bids: { orderBy: { placedAt: 'desc' }, take: 10 },
          _count: { select: { bids: true } },
        },
      });
      if (!a) throw HttpError.notFound('Auction not found.');
      return serializeAuction(a, { includeBids: true });
    },
  );

  // ─── Create (bot-bearer) — escrows the item ──────────────────────────
  app.post(
    '/guilds/:guildId/auctions',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateAuctionSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const {
        sellerId,
        itemId,
        quantity,
        startPriceCents,
        minIncrementCents,
        durationMs,
      } = req.body;

      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const item = await app.prisma.shopItem.findFirst({
        where: { id: itemId, guildId },
      });
      if (!item) throw HttpError.notFound('Item not found.');

      const created = await app.prisma.$transaction(async (tx) => {
        // Escrow the item: debit the seller's inventory atomically with the
        // auction insert so a crash mid-flight can't dupe items.
        const entry = await tx.inventoryEntry.findUnique({
          where: {
            guildId_userId_itemId: { guildId, userId: sellerId, itemId },
          },
        });
        if (!entry || entry.quantity < quantity) {
          throw HttpError.badRequest(
            'You do not own enough of that item to list.',
          );
        }
        await tx.inventoryEntry.update({
          where: {
            guildId_userId_itemId: { guildId, userId: sellerId, itemId },
          },
          data: { quantity: { decrement: quantity } },
        });
        const endsAt = new Date(Date.now() + durationMs);
        return tx.auction.create({
          data: {
            guildId,
            sellerId,
            itemId,
            quantity,
            startPriceCents,
            minIncrementCents,
            currentBidCents: 0,
            currentBidderId: null,
            endsAt,
            status: 'active',
          },
          include: { item: true, _count: { select: { bids: true } } },
        });
      });

      return serializeAuction(created);
    },
  );

  // ─── Place bid (bot-bearer) ──────────────────────────────────────────
  // Transactional: validate amount, debit bidder balance, refund previous
  // bidder, record the bid. Anti-snipe extends endsAt by 60s if needed.
  app.post(
    '/guilds/:guildId/auctions/:auctionId/bid',
    {
      preHandler: app.requireBot(),
      schema: { params: AuctionParams, body: PlaceBidSchema },
    },
    async (req) => {
      const { guildId, auctionId } = req.params;
      const { userId, amountCents } = req.body;

      const result = await app.prisma.$transaction(async (tx) => {
        const a = await tx.auction.findFirst({
          where: { id: auctionId, guildId },
        });
        if (!a) throw HttpError.notFound('Auction not found.');
        if (a.status !== 'active') {
          throw HttpError.conflict('Auction is not accepting bids.');
        }
        if (a.endsAt.getTime() <= Date.now()) {
          throw HttpError.conflict('Auction has ended.');
        }
        if (userId === a.sellerId) {
          throw HttpError.badRequest('You cannot bid on your own auction.');
        }

        // First bid must clear the start price. Subsequent bids must beat
        // currentBidCents + minIncrementCents.
        const floor =
          a.currentBidCents > 0
            ? a.currentBidCents + a.minIncrementCents
            : a.startPriceCents;
        if (amountCents < floor) {
          throw HttpError.badRequest(
            `Bid must be at least ${floor.toLocaleString()}.`,
          );
        }

        // Bidder must have the funds. We debit immediately to escrow.
        const balance = await tx.balance.findUnique({
          where: { guildId_userId: { guildId, userId } },
        });
        if (!balance || balance.amount < amountCents) {
          throw HttpError.badRequest('Insufficient balance to escrow this bid.');
        }
        await tx.balance.update({
          where: { guildId_userId: { guildId, userId } },
          data: { amount: { decrement: amountCents } },
        });

        // Refund the previous high bidder (if any). We look up their latest
        // non-refunded bid row and credit + stamp it in one go.
        if (a.currentBidderId && a.currentBidderId !== userId) {
          const prevBid = await tx.auctionBid.findFirst({
            where: {
              auctionId: a.id,
              userId: a.currentBidderId,
              refundedAt: null,
            },
            orderBy: { placedAt: 'desc' },
          });
          if (prevBid) {
            await tx.balance.upsert({
              where: {
                guildId_userId: { guildId, userId: a.currentBidderId },
              },
              create: {
                guildId,
                userId: a.currentBidderId,
                amount: prevBid.escrowedCents,
              },
              update: { amount: { increment: prevBid.escrowedCents } },
            });
            await tx.auctionBid.update({
              where: { id: prevBid.id },
              data: { refundedAt: new Date() },
            });
          }
        } else if (a.currentBidderId === userId) {
          // Same bidder raising their own bid: refund their prior escrow so
          // the net debit is (amountCents - prevAmount).
          const prevBid = await tx.auctionBid.findFirst({
            where: {
              auctionId: a.id,
              userId,
              refundedAt: null,
            },
            orderBy: { placedAt: 'desc' },
          });
          if (prevBid) {
            await tx.balance.upsert({
              where: { guildId_userId: { guildId, userId } },
              create: { guildId, userId, amount: prevBid.escrowedCents },
              update: { amount: { increment: prevBid.escrowedCents } },
            });
            await tx.auctionBid.update({
              where: { id: prevBid.id },
              data: { refundedAt: new Date() },
            });
          }
        }

        // Anti-snipe: bids in the final ANTI_SNIPE_WINDOW_MS extend endsAt
        // by the same amount.
        const msLeft = a.endsAt.getTime() - Date.now();
        const newEndsAt =
          msLeft < ANTI_SNIPE_WINDOW_MS
            ? new Date(Date.now() + ANTI_SNIPE_WINDOW_MS)
            : a.endsAt;

        const bid = await tx.auctionBid.create({
          data: {
            auctionId: a.id,
            userId,
            amountCents,
            escrowedCents: amountCents,
          },
        });

        const updated = await tx.auction.update({
          where: { id: a.id },
          data: {
            currentBidCents: amountCents,
            currentBidderId: userId,
            endsAt: newEndsAt,
          },
          include: {
            item: true,
            bids: { orderBy: { placedAt: 'desc' }, take: 10 },
            _count: { select: { bids: true } },
          },
        });

        return { updated, bid, extended: newEndsAt !== a.endsAt };
      });

      return {
        auction: serializeAuction(result.updated, { includeBids: true }),
        bid: serializeBid(result.bid),
        extended: result.extended,
      };
    },
  );

  // ─── Cancel (bot-bearer) — seller, only if no bids ───────────────────
  app.post(
    '/guilds/:guildId/auctions/:auctionId/cancel',
    {
      preHandler: app.requireBot(),
      schema: { params: AuctionParams, body: CancelAuctionSchema },
    },
    async (req) => {
      const { guildId, auctionId } = req.params;
      const { sellerId } = req.body;

      const refreshed = await app.prisma.$transaction(async (tx) => {
        const a = await tx.auction.findFirst({
          where: { id: auctionId, guildId },
        });
        if (!a) throw HttpError.notFound('Auction not found.');
        if (a.sellerId !== sellerId) {
          throw HttpError.forbidden('Only the seller can cancel this auction.');
        }
        if (a.status !== 'active') {
          throw HttpError.conflict('Auction is not active.');
        }
        if (a.currentBidderId) {
          throw HttpError.conflict('Cannot cancel an auction with bids.');
        }
        // Return the escrowed item to the seller.
        await tx.inventoryEntry.upsert({
          where: {
            guildId_userId_itemId: {
              guildId,
              userId: sellerId,
              itemId: a.itemId,
            },
          },
          create: {
            guildId,
            userId: sellerId,
            itemId: a.itemId,
            quantity: a.quantity,
          },
          update: { quantity: { increment: a.quantity } },
        });
        return tx.auction.update({
          where: { id: a.id },
          data: { status: 'cancelled', settledAt: new Date() },
          include: {
            item: true,
            bids: { orderBy: { placedAt: 'desc' }, take: 10 },
            _count: { select: { bids: true } },
          },
        });
      });

      return serializeAuction(refreshed, { includeBids: true });
    },
  );

  // ─── Settle (bot-bearer) — scheduler runs this when endsAt passes ────
  // Transfers item to winner, credits seller, refunds any stale losing
  // bids (defensive — they should already be refunded on outbid).
  app.post(
    '/guilds/:guildId/auctions/:auctionId/settle',
    {
      preHandler: app.requireBot(),
      schema: { params: AuctionParams },
    },
    async (req) => {
      const { guildId, auctionId } = req.params;

      const settled = await app.prisma.$transaction(async (tx) => {
        const a = await tx.auction.findFirst({
          where: { id: auctionId, guildId },
        });
        if (!a) throw HttpError.notFound('Auction not found.');
        if (a.status === 'ended') {
          // Idempotent — return the existing record.
          return tx.auction.findUniqueOrThrow({
            where: { id: a.id },
            include: {
              item: true,
              bids: { orderBy: { placedAt: 'desc' }, take: 10 },
              _count: { select: { bids: true } },
            },
          });
        }
        if (a.status !== 'active') {
          throw HttpError.conflict('Auction cannot be settled.');
        }

        // Defensive: refund any non-refunded losing bids. The winning bid is
        // identified by userId === currentBidderId AND amountCents === currentBidCents.
        if (a.currentBidderId) {
          const stale = await tx.auctionBid.findMany({
            where: {
              auctionId: a.id,
              refundedAt: null,
              NOT: {
                AND: [
                  { userId: a.currentBidderId },
                  { amountCents: a.currentBidCents },
                ],
              },
            },
          });
          for (const b of stale) {
            await tx.balance.upsert({
              where: { guildId_userId: { guildId, userId: b.userId } },
              create: { guildId, userId: b.userId, amount: b.escrowedCents },
              update: { amount: { increment: b.escrowedCents } },
            });
            await tx.auctionBid.update({
              where: { id: b.id },
              data: { refundedAt: new Date() },
            });
          }

          // Credit the seller with the winning amount.
          await tx.balance.upsert({
            where: { guildId_userId: { guildId, userId: a.sellerId } },
            create: { guildId, userId: a.sellerId, amount: a.currentBidCents },
            update: { amount: { increment: a.currentBidCents } },
          });
          // Transfer the item to the winner.
          await tx.inventoryEntry.upsert({
            where: {
              guildId_userId_itemId: {
                guildId,
                userId: a.currentBidderId,
                itemId: a.itemId,
              },
            },
            create: {
              guildId,
              userId: a.currentBidderId,
              itemId: a.itemId,
              quantity: a.quantity,
            },
            update: { quantity: { increment: a.quantity } },
          });
        } else {
          // No bids — return the item to the seller.
          await tx.inventoryEntry.upsert({
            where: {
              guildId_userId_itemId: {
                guildId,
                userId: a.sellerId,
                itemId: a.itemId,
              },
            },
            create: {
              guildId,
              userId: a.sellerId,
              itemId: a.itemId,
              quantity: a.quantity,
            },
            update: { quantity: { increment: a.quantity } },
          });
        }

        return tx.auction.update({
          where: { id: a.id },
          data: { status: 'ended', settledAt: new Date() },
          include: {
            item: true,
            bids: { orderBy: { placedAt: 'desc' }, take: 10 },
            _count: { select: { bids: true } },
          },
        });
      });

      return serializeAuction(settled, { includeBids: true });
    },
  );
};
