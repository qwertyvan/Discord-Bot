import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const GiveawayStatusSchema = z.enum(['active', 'ended', 'cancelled']);
export type GiveawayStatus = z.infer<typeof GiveawayStatusSchema>;

export const GiveawayWinnerSchema = z.object({
  id: z.string().uuid(),
  giveawayId: z.string().uuid(),
  userId: SnowflakeSchema,
  drawAt: z.string().datetime(),
});

export type GiveawayWinner = z.infer<typeof GiveawayWinnerSchema>;

export const GiveawayEntrySchema = z.object({
  giveawayId: z.string().uuid(),
  userId: SnowflakeSchema,
  weight: z.number().int().min(1),
  createdAt: z.string().datetime(),
});

export type GiveawayEntry = z.infer<typeof GiveawayEntrySchema>;

export const GiveawaySchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema.nullable(),
  prize: z.string().min(1).max(200),
  hostId: SnowflakeSchema,
  endsAt: z.string().datetime(),
  winnerCount: z.number().int().min(1).max(50),
  requireRoleId: SnowflakeSchema.nullable(),
  requireMinLevel: z.number().int().min(0).nullable(),
  weightedBonusRoles: z.array(SnowflakeSchema),
  status: GiveawayStatusSchema,
  createdAt: z.string().datetime(),
  entryCount: z.number().int().nonnegative(),
  winners: z.array(GiveawayWinnerSchema),
});

export type Giveaway = z.infer<typeof GiveawaySchema>;

export const CreateGiveawaySchema = z.object({
  channelId: SnowflakeSchema,
  prize: z.string().min(1).max(200),
  hostId: SnowflakeSchema,
  endsAt: z.string().datetime(),
  winnerCount: z.number().int().min(1).max(50).optional(),
  requireRoleId: SnowflakeSchema.optional(),
  requireMinLevel: z.number().int().min(0).optional(),
  weightedBonusRoles: z.array(SnowflakeSchema).max(25).optional(),
});

export type CreateGiveawayInput = z.infer<typeof CreateGiveawaySchema>;

export const EnterGiveawaySchema = z.object({
  userId: SnowflakeSchema,
  weight: z.number().int().min(1).max(100).optional(),
});

export type EnterGiveawayInput = z.infer<typeof EnterGiveawaySchema>;
