import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// v0.57 open-bid timed auctions on inventory items. Currency is escrowed at
// bid time and refunded when outbid; the seller's item is escrowed at create
// time. Anti-snipe: bids in the final 60s extend the auction by 60s.

export const AuctionStatusSchema = z.enum(['active', 'ended', 'cancelled']);
export type AuctionStatus = z.infer<typeof AuctionStatusSchema>;

export const AuctionBidSchema = z.object({
  id: z.string().uuid(),
  auctionId: z.string().uuid(),
  userId: SnowflakeSchema,
  amountCents: z.number().int().nonnegative(),
  escrowedCents: z.number().int().nonnegative(),
  placedAt: z.string().datetime(),
  refundedAt: z.string().datetime().nullable(),
});
export type AuctionBid = z.infer<typeof AuctionBidSchema>;

export const AuctionSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  sellerId: SnowflakeSchema,
  itemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  startPriceCents: z.number().int().nonnegative(),
  minIncrementCents: z.number().int().positive(),
  currentBidCents: z.number().int().nonnegative(),
  currentBidderId: SnowflakeSchema.nullable(),
  endsAt: z.string().datetime(),
  status: AuctionStatusSchema,
  createdAt: z.string().datetime(),
  settledAt: z.string().datetime().nullable(),
  // Convenience: total number of bids placed on this auction (refunded + active).
  bidCount: z.number().int().nonnegative(),
  // Denormalized item snapshot for embed rendering.
  itemName: z.string().nullable(),
  itemSlug: z.string().nullable(),
  // Optional bid feed (most recent first). The list/get endpoints return at
  // most 10; settle/create may return [].
  bids: z.array(AuctionBidSchema).optional(),
});
export type Auction = z.infer<typeof AuctionSchema>;

export const CreateAuctionSchema = z.object({
  sellerId: SnowflakeSchema,
  itemId: z.string().uuid(),
  quantity: z.number().int().positive().max(1000).default(1),
  startPriceCents: z.number().int().nonnegative().max(1_000_000_000),
  minIncrementCents: z.number().int().positive().max(1_000_000_000).default(1),
  // Duration in milliseconds. 1 minute minimum, 30 days maximum.
  durationMs: z
    .number()
    .int()
    .min(60_000)
    .max(30 * 24 * 60 * 60_000),
});
export type CreateAuctionInput = z.infer<typeof CreateAuctionSchema>;

export const PlaceBidSchema = z.object({
  userId: SnowflakeSchema,
  amountCents: z.number().int().positive().max(1_000_000_000),
});
export type PlaceBidInput = z.infer<typeof PlaceBidSchema>;

export const CancelAuctionSchema = z.object({
  sellerId: SnowflakeSchema,
});
export type CancelAuctionInput = z.infer<typeof CancelAuctionSchema>;
