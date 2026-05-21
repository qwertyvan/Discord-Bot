import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const LevelRoleRewardSchema = z.object({
  level: z.number().int().min(1).max(1000),
  roleId: SnowflakeSchema,
});

export type LevelRoleReward = z.infer<typeof LevelRoleRewardSchema>;

export const LevelConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  perMessageXp: z.number().int().min(0).max(1000),
  textCooldownSeconds: z.number().int().min(0).max(3600),
  voiceXpPerMinute: z.number().int().min(0).max(1000),
  levelUpChannelId: SnowflakeSchema.nullable(),
  levelUpTemplate: z.string().min(1).max(2000).nullable(),
  channelMultipliers: z.record(SnowflakeSchema, z.number().min(0).max(10)),
  roleRewards: z.array(LevelRoleRewardSchema),
  noXpRoleIds: z.array(SnowflakeSchema),
});

export type LevelConfig = z.infer<typeof LevelConfigSchema>;

export const UpdateLevelConfigSchema = LevelConfigSchema.omit({ guildId: true }).partial();
export type UpdateLevelConfigInput = z.infer<typeof UpdateLevelConfigSchema>;

export const MemberLevelSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  xp: z.number().int().nonnegative(),
  voiceMinutes: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
  rank: z.number().int().positive().nullable(),
  nextLevelXp: z.number().int().nonnegative(),
  currentLevelXp: z.number().int().nonnegative(),
});

export type MemberLevel = z.infer<typeof MemberLevelSchema>;

/**
 * Triangular curve: total XP required to be ≥ level L is 50 * L * (L + 1).
 *
 *   level 1 →  100 XP
 *   level 2 →  300 XP   (200 to advance)
 *   level 3 →  600 XP   (300 to advance)
 *   ...
 *
 * Cheap to compute, easy to reason about, gentle ramp.
 */
export function xpForLevel(level: number): number {
  return 50 * level * (level + 1);
}

export function levelFromXp(xp: number): number {
  if (xp < 100) return 0;
  // Solve 50 * L * (L+1) <= xp → L = floor((sqrt(1 + xp/12.5) - 1) / 2)
  const L = Math.floor((Math.sqrt(1 + xp / 12.5) - 1) / 2);
  // Adjust for floating-point edge cases.
  if (xpForLevel(L + 1) <= xp) return L + 1;
  if (xpForLevel(L) > xp) return Math.max(0, L - 1);
  return L;
}
