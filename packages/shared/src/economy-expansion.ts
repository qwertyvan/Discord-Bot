import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Expanded shop / inventory / gambling / loot schemas. The legacy
// virtual+role shop in economy.ts continues to work; these schemas describe
// the v0.49 endpoints under /shop-items, /inventory, /games, /loot-drops.

export const ShopItemKindExtSchema = z.enum([
  'consumable',
  'role',
  'badge',
  'cosmetic',
]);
export type ShopItemKindExt = z.infer<typeof ShopItemKindExtSchema>;

// Slugs are stable per-guild identifiers used by /buy and /use autocompletion.
const SlugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/, 'Slug must be kebab/snake-case.');

export const ShopItemExtSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  slug: SlugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  priceCents: z.number().int().min(0).max(1_000_000_000),
  stock: z.number().int().min(0).nullable(),
  kind: ShopItemKindExtSchema,
  roleId: SnowflakeSchema.nullable(),
  message: z.string().max(2000).nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ShopItemExt = z.infer<typeof ShopItemExtSchema>;

export const UpsertShopItemSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  priceCents: z.number().int().min(0).max(1_000_000_000),
  stock: z.number().int().min(0).optional(),
  kind: ShopItemKindExtSchema.default('consumable'),
  roleId: SnowflakeSchema.optional(),
  message: z.string().max(2000).optional(),
  enabled: z.boolean().default(true),
});
export type UpsertShopItemInput = z.infer<typeof UpsertShopItemSchema>;

export const InventoryEntryExtSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  itemId: z.string().uuid(),
  quantity: z.number().int().nonnegative(),
  acquiredAt: z.string().datetime(),
  item: ShopItemExtSchema.optional(),
});
export type InventoryEntryExt = z.infer<typeof InventoryEntryExtSchema>;

// Gift another user a slug-referenced item. Quantity defaults to 1.
export const GiftRequestSchema = z.object({
  fromUserId: SnowflakeSchema,
  toUserId: SnowflakeSchema,
  itemId: z.string().uuid(),
  quantity: z.number().int().positive().max(1000).default(1),
});
export type GiftRequest = z.infer<typeof GiftRequestSchema>;

export const ConsumeItemSchema = z.object({
  userId: SnowflakeSchema,
  itemId: z.string().uuid(),
  quantity: z.number().int().positive().max(100).default(1),
});
export type ConsumeItemInput = z.infer<typeof ConsumeItemSchema>;

export const ConsumeItemResultSchema = z.object({
  item: ShopItemExtSchema,
  remaining: z.number().int().nonnegative(),
  message: z.string().nullable(),
  roleGranted: SnowflakeSchema.nullable(),
});
export type ConsumeItemResult = z.infer<typeof ConsumeItemResultSchema>;

// Mini-games -------------------------------------------------------------

export const BetRequestSchema = z.object({
  userId: SnowflakeSchema,
  bet: z.number().int().positive().max(10_000_000),
});
export type BetRequest = z.infer<typeof BetRequestSchema>;

export const DiceChoiceSchema = z.enum([
  'high',
  'low',
  'even',
  'odd',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
]);
export type DiceChoice = z.infer<typeof DiceChoiceSchema>;

export const DiceRequestSchema = BetRequestSchema.extend({
  choice: DiceChoiceSchema,
});
export type DiceRequest = z.infer<typeof DiceRequestSchema>;

// Cards are an integer rank 1..13 with a suit character. Server-side state
// only — clients never trust nor send raw cards.
export const BlackjackCardSchema = z.object({
  rank: z.number().int().min(1).max(13),
  suit: z.enum(['♠', '♥', '♦', '♣']),
});
export type BlackjackCard = z.infer<typeof BlackjackCardSchema>;

export const BlackjackStateSchema = z.object({
  gameId: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  bet: z.number().int().positive(),
  playerHand: z.array(BlackjackCardSchema),
  dealerHand: z.array(BlackjackCardSchema),
  // Dealer hole card is hidden until the player stands or busts. The server
  // returns one face-down placeholder; the full hand is revealed on finish.
  dealerVisible: z.array(BlackjackCardSchema),
  playerTotal: z.number().int(),
  dealerTotal: z.number().int(),
  status: z.enum(['active', 'player-bust', 'dealer-bust', 'player-win', 'dealer-win', 'push', 'blackjack']),
  payout: z.number().int(),
  // ISO timestamp at which an inactive game expires (5 minutes from start).
  expiresAt: z.string().datetime(),
});
export type BlackjackState = z.infer<typeof BlackjackStateSchema>;

export const SlotsResultSchema = z.object({
  reels: z.tuple([z.string(), z.string(), z.string()]),
  // multiplier on the original bet (0 = lost, 1 = even money push, etc.).
  multiplier: z.number().nonnegative(),
  // delta = (multiplier - 1) * bet. Stored explicitly so clients don't
  // re-derive it incorrectly.
  delta: z.number().int(),
  balance: z.number().int(),
});
export type SlotsResult = z.infer<typeof SlotsResultSchema>;

export const DiceResultSchema = z.object({
  roll: z.number().int().min(1).max(6),
  choice: DiceChoiceSchema,
  win: z.boolean(),
  multiplier: z.number().nonnegative(),
  delta: z.number().int(),
  balance: z.number().int(),
});
export type DiceResult = z.infer<typeof DiceResultSchema>;

// Loot crates -----------------------------------------------------------

export const LootDropSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  slug: SlugSchema,
  itemId: z.string().uuid().nullable(),
  currencyMin: z.number().int().nonnegative(),
  currencyMax: z.number().int().nonnegative(),
  weight: z.number().int().positive(),
  item: ShopItemExtSchema.optional().nullable(),
});
export type LootDrop = z.infer<typeof LootDropSchema>;

export const UpsertLootDropSchema = z.object({
  slug: SlugSchema,
  itemId: z.string().uuid().nullable().optional(),
  currencyMin: z.number().int().nonnegative().default(0),
  currencyMax: z.number().int().nonnegative().default(0),
  weight: z.number().int().positive().max(10_000).default(1),
});
export type UpsertLootDropInput = z.infer<typeof UpsertLootDropSchema>;

export const LootClaimResultSchema = z.object({
  drop: LootDropSchema,
  currencyAwarded: z.number().int().nonnegative(),
  itemAwarded: ShopItemExtSchema.nullable(),
  balance: z.number().int(),
  streak: z.number().int().nonnegative(),
  nextClaimAt: z.string().datetime(),
});
export type LootClaimResult = z.infer<typeof LootClaimResultSchema>;
