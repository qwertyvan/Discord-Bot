import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';
import { ShopItemExtSchema } from './economy-expansion.js';

// Peer-to-peer marketplace types (v0.56). A MarketListing is a seller's
// offer to trade N units of one ShopItem for a fixed total `priceCents`.
// While the listing is active the underlying item units sit in escrow —
// they're debited from the seller's InventoryEntry at create time and only
// returned (on cancel/expire) or transferred (on buy) by the API.

export const MarketListingStatusSchema = z.enum([
  'active',
  'sold',
  'cancelled',
  'expired',
]);
export type MarketListingStatus = z.infer<typeof MarketListingStatusSchema>;

export const MarketListingSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  sellerId: SnowflakeSchema,
  itemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  listedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  status: MarketListingStatusSchema,
  buyerId: SnowflakeSchema.nullable(),
  completedAt: z.string().datetime().nullable(),
  // Hydrated on the responses that include the shop item join.
  item: ShopItemExtSchema.optional(),
});
export type MarketListing = z.infer<typeof MarketListingSchema>;

// Body for POST /guilds/:gid/listings. `sellerJoinedAt` lets the API enforce
// the per-guild `minTenureDays` floor without needing to fetch the Discord
// member itself.
export const CreateListingSchema = z.object({
  sellerId: SnowflakeSchema,
  itemId: z.string().uuid(),
  quantity: z.number().int().positive().max(1000).default(1),
  priceCents: z.number().int().positive().max(1_000_000_000),
  sellerJoinedAt: z.string().datetime(),
});
export type CreateListingInput = z.infer<typeof CreateListingSchema>;

// Body for POST /guilds/:gid/listings/:id/buy.
export const BuyListingSchema = z.object({
  buyerId: SnowflakeSchema,
});
export type BuyListingInput = z.infer<typeof BuyListingSchema>;

// Body for POST /guilds/:gid/listings/:id/cancel — restricted to the seller
// (or callers with ManageGuild via the dashboard, but the bot-bearer route
// trusts the caller-provided id).
export const CancelListingSchema = z.object({
  requesterId: SnowflakeSchema,
});
export type CancelListingInput = z.infer<typeof CancelListingSchema>;

export const MarketConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  minTenureDays: z.number().int().nonnegative(),
  maxActiveListingsPerUser: z.number().int().positive(),
});
export type MarketConfig = z.infer<typeof MarketConfigSchema>;

export const UpsertMarketConfigSchema = z.object({
  enabled: z.boolean().optional(),
  minTenureDays: z.number().int().min(0).max(365).optional(),
  maxActiveListingsPerUser: z.number().int().min(1).max(100).optional(),
});
export type UpsertMarketConfigInput = z.infer<typeof UpsertMarketConfigSchema>;

// Query for GET /guilds/:gid/listings.
export const ListingFilterSchema = z.object({
  status: MarketListingStatusSchema.optional(),
  sellerId: SnowflakeSchema.optional(),
  itemSlug: z.string().min(1).max(48).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListingFilter = z.infer<typeof ListingFilterSchema>;
