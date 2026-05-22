import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Per-guild member-milestone config (joinaversary + boost-reward knobs).
// Tenure rules live in their own table — see TenureRoleRuleSchema below.
export const MilestoneConfigSchema = z.object({
  guildId: SnowflakeSchema,
  joinaversaryChannelId: SnowflakeSchema.nullable(),
  joinaversaryTemplate: z.string().min(1).max(500).nullable(),
  joinaversaryReward: z.number().int().nonnegative(),
  boostChannelId: SnowflakeSchema.nullable(),
  boostRoleId: SnowflakeSchema.nullable(),
  boostReward: z.number().int().nonnegative(),
  enabled: z.boolean(),
});

export type MilestoneConfig = z.infer<typeof MilestoneConfigSchema>;

// Partial-update body for PUT /guilds/:gid/milestone-config. Pass `null` to
// clear a snowflake or template; missing keys leave the existing value alone.
export const UpsertMilestoneConfigSchema = z.object({
  joinaversaryChannelId: SnowflakeSchema.nullable().optional(),
  joinaversaryTemplate: z.string().min(1).max(500).nullable().optional(),
  joinaversaryReward: z.number().int().nonnegative().optional(),
  boostChannelId: SnowflakeSchema.nullable().optional(),
  boostRoleId: SnowflakeSchema.nullable().optional(),
  boostReward: z.number().int().nonnegative().optional(),
  enabled: z.boolean().optional(),
});

export type UpsertMilestoneConfigInput = z.infer<typeof UpsertMilestoneConfigSchema>;

// Tenure role rule: auto-grant a Discord role once a member crosses
// `daysRequired` days of membership in the guild.
export const TenureRoleRuleSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  roleId: SnowflakeSchema,
  daysRequired: z.number().int().min(1).max(36_500),
  createdAt: z.string().datetime(),
});

export type TenureRoleRule = z.infer<typeof TenureRoleRuleSchema>;

export const UpsertTenureRoleRuleSchema = z.object({
  roleId: SnowflakeSchema,
  daysRequired: z.number().int().min(1).max(36_500),
});

export type UpsertTenureRoleRuleInput = z.infer<typeof UpsertTenureRoleRuleSchema>;

// One award row per (guild, user, kind, payload-disambiguator). The
// scheduler/event handlers consult this ledger to stay idempotent across
// restarts and re-ticks.
export const MilestoneAwardKindSchema = z.enum(['joinaversary', 'boost', 'tenure', 'levelup']);
export type MilestoneAwardKind = z.infer<typeof MilestoneAwardKindSchema>;

export const MilestoneAwardSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  kind: MilestoneAwardKindSchema,
  payload: z.record(z.string(), z.unknown()).nullable(),
  awardedAt: z.string().datetime(),
});

export type MilestoneAward = z.infer<typeof MilestoneAwardSchema>;

export const CreateMilestoneAwardSchema = z.object({
  userId: SnowflakeSchema,
  kind: MilestoneAwardKindSchema,
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type CreateMilestoneAwardInput = z.infer<typeof CreateMilestoneAwardSchema>;
