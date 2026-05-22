import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const ActivityRoleActionSchema = z.enum(['grant', 'revoke']);
export type ActivityRoleAction = z.infer<typeof ActivityRoleActionSchema>;

export const ActivityRoleRuleSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  roleId: SnowflakeSchema,
  minMessages: z.number().int().nonnegative(),
  minVoiceMinutes: z.number().int().nonnegative(),
  windowDays: z.number().int().min(1).max(365),
  action: ActivityRoleActionSchema,
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
});

export type ActivityRoleRule = z.infer<typeof ActivityRoleRuleSchema>;

export const UpsertActivityRoleRuleSchema = z.object({
  roleId: SnowflakeSchema,
  minMessages: z.number().int().nonnegative().optional(),
  minVoiceMinutes: z.number().int().nonnegative().optional(),
  windowDays: z.number().int().min(1).max(365).optional(),
  action: ActivityRoleActionSchema.optional(),
  enabled: z.boolean().optional(),
});

export type UpsertActivityRoleRuleInput = z.infer<typeof UpsertActivityRoleRuleSchema>;

export const InactivityPrunePolicySchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  inactiveDays: z.number().int().min(1).max(365),
  excludeRoleIds: z.array(SnowflakeSchema),
  notifyDm: z.boolean(),
});

export type InactivityPrunePolicy = z.infer<typeof InactivityPrunePolicySchema>;

export const UpsertPolicySchema = z.object({
  enabled: z.boolean().optional(),
  inactiveDays: z.number().int().min(1).max(365).optional(),
  excludeRoleIds: z.array(SnowflakeSchema).optional(),
  notifyDm: z.boolean().optional(),
});

export type UpsertPolicyInput = z.infer<typeof UpsertPolicySchema>;

export const MemberActivitySchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  messages: z.number().int().nonnegative(),
  voiceMinutes: z.number().int().nonnegative(),
  lastActiveAt: z.string().datetime(),
});

export type MemberActivity = z.infer<typeof MemberActivitySchema>;

// Bulk-upsert payload entry from the bot's flush. `messages` and
// `voiceMinutes` are increments (deltas) — `touch:true` updates lastActiveAt
// without adjusting counters.
export const MemberActivityBatchEntrySchema = z.object({
  userId: SnowflakeSchema,
  messages: z.number().int().nonnegative().optional(),
  voiceMinutes: z.number().int().nonnegative().optional(),
  touch: z.boolean().optional(),
});

export type MemberActivityBatchEntry = z.infer<typeof MemberActivityBatchEntrySchema>;

export const MemberActivityBatchSchema = z.object({
  entries: z.array(MemberActivityBatchEntrySchema).min(1).max(500),
});

export type MemberActivityBatchInput = z.infer<typeof MemberActivityBatchSchema>;

// Prune preview: a candidate to be kicked. Returned by `/prune/preview` and
// (with `kicked:true` when actually kicked) by `/prune/execute`.
export const PruneCandidateSchema = z.object({
  userId: SnowflakeSchema,
  lastActiveAt: z.string().datetime().nullable(),
});

export type PruneCandidate = z.infer<typeof PruneCandidateSchema>;
