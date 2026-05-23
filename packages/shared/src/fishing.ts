import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Fishing skill tiers. The level number stored on the FishingSkill row is
// the canonical source; this enum is the "named" view of (1..3+) and is
// used in copy and to gate special drops.
//   - bait (level 1): newcomer; sees only minLevel ≤ 1 drops
//   - intermediate (level 2): unlocks minLevel ≤ 2 drops
//   - master (level 3+): unlocks the full table
export const FishingSkillTierSchema = z.enum(['bait', 'intermediate', 'master']);
export type FishingSkillTier = z.infer<typeof FishingSkillTierSchema>;

// XP thresholds for each tier. Crossing a threshold during /fish resolve
// bumps the player's level and is surfaced in the result embed.
export const FISHING_LEVEL_THRESHOLDS = [0, 50, 200] as const;

export function fishingTierForLevel(level: number): FishingSkillTier {
  if (level >= 3) return 'master';
  if (level === 2) return 'intermediate';
  return 'bait';
}

const SlugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/, 'Slug must be kebab/snake-case.');

export const FishingSkillSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  xp: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  casts: z.number().int().nonnegative(),
  tier: FishingSkillTierSchema,
  nextLevelXp: z.number().int().nonnegative().nullable(),
});
export type FishingSkill = z.infer<typeof FishingSkillSchema>;

export const FishingDropSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  slug: SlugSchema,
  itemId: z.string().uuid().nullable(),
  name: z.string().min(1).max(120),
  emoji: z.string().min(1).max(64),
  minLevel: z.number().int().positive(),
  weight: z.number().int().positive(),
  currencyMin: z.number().int().nonnegative(),
  currencyMax: z.number().int().nonnegative(),
  xpReward: z.number().int().nonnegative(),
  enabled: z.boolean(),
});
export type FishingDrop = z.infer<typeof FishingDropSchema>;

export const CreateFishingDropSchema = z.object({
  slug: SlugSchema,
  name: z.string().min(1).max(120),
  emoji: z.string().min(1).max(64).default('🐟'),
  itemId: z.string().uuid().nullable().optional(),
  minLevel: z.number().int().min(1).max(99).default(1),
  weight: z.number().int().positive().max(10_000).default(10),
  currencyMin: z.number().int().nonnegative().default(0),
  currencyMax: z.number().int().nonnegative().default(0),
  xpReward: z.number().int().nonnegative().max(10_000).default(5),
  enabled: z.boolean().default(true),
});
export type CreateFishingDropInput = z.infer<typeof CreateFishingDropSchema>;

export const FishingCastSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  startedAt: z.string().datetime(),
  resolvesAt: z.string().datetime(),
  resolved: z.boolean(),
  dropId: z.string().uuid().nullable(),
  currencyEarned: z.number().int().nonnegative(),
  xpEarned: z.number().int().nonnegative(),
});
export type FishingCast = z.infer<typeof FishingCastSchema>;

// Result returned by POST /fishing/resolve. Bundles the resolved cast,
// the chosen drop (if any), the new skill state, and whether the player
// levelled up so the bot can flavour the result embed accordingly.
export const CastResultSchema = z.object({
  cast: FishingCastSchema,
  drop: FishingDropSchema.nullable(),
  skill: FishingSkillSchema,
  leveledUp: z.boolean(),
  previousLevel: z.number().int().positive(),
});
export type CastResult = z.infer<typeof CastResultSchema>;
