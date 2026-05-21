import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const ModActionTypeSchema = z.enum([
  'WARN',
  'KICK',
  'BAN',
  'UNBAN',
  'SOFTBAN',
  'TIMEOUT',
  'UNTIMEOUT',
  'MUTE',
  'UNMUTE',
  'NOTE',
]);

export type ModActionType = z.infer<typeof ModActionTypeSchema>;

export const ModActionSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  caseNumber: z.number().int().positive(),
  type: ModActionTypeSchema,
  userId: SnowflakeSchema,
  moderatorId: SnowflakeSchema,
  reason: z.string().min(1).max(500),
  durationMs: z.number().int().positive().nullable(),
  expiresAt: z.string().datetime().nullable(),
  category: z.string().max(64).nullable(),
  severity: z.number().int().min(1).max(5).nullable(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
});

export type ModAction = z.infer<typeof ModActionSchema>;

export const CreateModActionSchema = z.object({
  type: ModActionTypeSchema,
  userId: SnowflakeSchema,
  moderatorId: SnowflakeSchema,
  reason: z.string().min(1).max(500),
  durationMs: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  category: z.string().max(64).optional(),
  severity: z.number().int().min(1).max(5).optional(),
});

export type CreateModActionInput = z.infer<typeof CreateModActionSchema>;

export const ModActionListQuerySchema = z.object({
  userId: SnowflakeSchema.optional(),
  type: ModActionTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

export type ModActionListQuery = z.infer<typeof ModActionListQuerySchema>;

/**
 * Auto-escalation policy: when a user accumulates N active warnings, apply
 * the named action. Resolved in ascending `count` order; the highest matching
 * threshold wins.
 */
export const WarningThresholdSchema = z.object({
  count: z.number().int().min(1).max(100),
  action: z.enum(['TIMEOUT', 'KICK', 'BAN']),
  durationMs: z.number().int().positive().optional(),
});

export type WarningThreshold = z.infer<typeof WarningThresholdSchema>;

export const WarningPolicySchema = z.object({
  guildId: SnowflakeSchema,
  expireDays: z.number().int().min(1).max(365).nullable(),
  thresholds: z.array(WarningThresholdSchema),
  muteRoleId: SnowflakeSchema.nullable(),
});

export type WarningPolicy = z.infer<typeof WarningPolicySchema>;

export const UpdateWarningPolicySchema = WarningPolicySchema.omit({ guildId: true }).partial();
export type UpdateWarningPolicyInput = z.infer<typeof UpdateWarningPolicySchema>;
