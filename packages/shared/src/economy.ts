import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const EconomyConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  currencyName: z.string().min(1).max(32),
  currencySymbol: z.string().min(1).max(16),
  startingBalance: z.number().int().min(0).max(1_000_000),
  dailyReward: z.number().int().min(0).max(1_000_000),
  dailyCooldownSeconds: z.number().int().min(60).max(7 * 86_400),
  workMin: z.number().int().min(0).max(1_000_000),
  workMax: z.number().int().min(0).max(1_000_000),
  workCooldownSeconds: z.number().int().min(0).max(86_400),
  gamblingEnabled: z.boolean(),
});

export type EconomyConfig = z.infer<typeof EconomyConfigSchema>;

export const UpdateEconomyConfigSchema = EconomyConfigSchema.omit({ guildId: true }).partial();
export type UpdateEconomyConfigInput = z.infer<typeof UpdateEconomyConfigSchema>;

export const BalanceSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  amount: z.number().int(),
  lastDailyAt: z.string().datetime().nullable(),
  lastWorkAt: z.string().datetime().nullable(),
});

export type Balance = z.infer<typeof BalanceSchema>;

export const ShopItemKindSchema = z.enum(['virtual', 'role']);
export type ShopItemKind = z.infer<typeof ShopItemKindSchema>;

export const ShopItemSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  name: z.string().min(1).max(64),
  description: z.string().max(300).nullable(),
  price: z.number().int().min(0).max(10_000_000),
  kind: ShopItemKindSchema,
  roleId: SnowflakeSchema.nullable(),
  stock: z.number().int().min(0).nullable(),
  createdAt: z.string().datetime(),
});

export type ShopItem = z.infer<typeof ShopItemSchema>;

export const CreateShopItemSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(300).optional(),
  price: z.number().int().min(0).max(10_000_000),
  kind: ShopItemKindSchema.default('virtual'),
  roleId: SnowflakeSchema.optional(),
  stock: z.number().int().min(0).optional(),
});

export type CreateShopItemInput = z.infer<typeof CreateShopItemSchema>;

export const InventoryEntrySchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  itemId: z.string().uuid(),
  quantity: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  item: ShopItemSchema.optional(),
});

export type InventoryEntry = z.infer<typeof InventoryEntrySchema>;
