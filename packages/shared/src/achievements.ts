import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// What activity counter drives the threshold check. `custom` achievements
// are awarded only via direct API calls (e.g. helper-of-the-day flows).
export const AchievementKindSchema = z.enum([
  'messages',
  'voice_minutes',
  'level',
  'reactions',
  'stickers',
  'custom',
]);
export type AchievementKind = z.infer<typeof AchievementKindSchema>;

// Slug doubles as a stable, human-friendly identifier for the seed catalogue
// and as a target for `/achievements admin remove <slug>`.
export const AchievementSlugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase, digits, `_` or `-` only');

export const AchievementSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  slug: AchievementSlugSchema,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  emoji: z.string().min(1).max(64),
  kind: AchievementKindSchema,
  threshold: z.number().int().min(1),
  badgeSlug: z.string().min(1).max(48).nullable(),
  currencyReward: z.number().int().nonnegative(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Achievement = z.infer<typeof AchievementSchema>;

export const CreateAchievementSchema = z.object({
  slug: AchievementSlugSchema,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  emoji: z.string().min(1).max(64).optional(),
  kind: AchievementKindSchema,
  threshold: z.number().int().min(1).default(1),
  badgeSlug: z.string().min(1).max(48).nullable().optional(),
  currencyReward: z.number().int().nonnegative().optional(),
  enabled: z.boolean().optional(),
});
export type CreateAchievementInput = z.infer<typeof CreateAchievementSchema>;

export const UpdateAchievementSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(300).optional(),
  emoji: z.string().min(1).max(64).optional(),
  kind: AchievementKindSchema.optional(),
  threshold: z.number().int().min(1).optional(),
  badgeSlug: z.string().min(1).max(48).nullable().optional(),
  currencyReward: z.number().int().nonnegative().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateAchievementInput = z.infer<typeof UpdateAchievementSchema>;

export const UserAchievementSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  achievementId: z.string().uuid(),
  unlockedAt: z.string().datetime(),
  progressAtUnlock: z.number().int().nonnegative(),
});
export type UserAchievement = z.infer<typeof UserAchievementSchema>;

// `slug` resolves to an Achievement on the server side; the bot supplies its
// current observed counter (`progress`) so we can persist the watermark and
// the API can pick the right achievement row idempotently.
export const AwardAchievementSchema = z.object({
  userId: SnowflakeSchema,
  slug: AchievementSlugSchema,
  progress: z.number().int().nonnegative(),
});
export type AwardAchievementInput = z.infer<typeof AwardAchievementSchema>;

// Bot-side "did this event cross any threshold?" probe. The API answers
// with the *unawarded* highest-threshold-≤-currentValue achievement (if any).
// Kept here so the bot evaluator and the API agree on the contract.
export const EvaluateRequestSchema = z.object({
  userId: SnowflakeSchema,
  kind: AchievementKindSchema,
  currentValue: z.number().int().nonnegative(),
});
export type EvaluateRequestInput = z.infer<typeof EvaluateRequestSchema>;

export interface AwardAchievementResult {
  unlocked: boolean;
  achievement: Achievement;
  userAchievement: UserAchievement | null;
}
