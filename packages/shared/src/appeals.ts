import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// ─── Warning ladder ──────────────────────────────────────────────────────

export const LadderActionSchema = z.enum(['mute', 'kick', 'ban']);
export type LadderAction = z.infer<typeof LadderActionSchema>;

export const WarningLadderStepSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  threshold: z.number().int().positive(),
  action: LadderActionSchema,
  durationMinutes: z.number().int().positive().nullable(),
});

export type WarningLadderStep = z.infer<typeof WarningLadderStepSchema>;

export const UpsertLadderStepSchema = z.object({
  threshold: z.number().int().positive(),
  action: LadderActionSchema,
  durationMinutes: z.number().int().positive().optional(),
});

export type UpsertLadderStepInput = z.infer<typeof UpsertLadderStepSchema>;

// ─── Appeals ─────────────────────────────────────────────────────────────

export const AppealStatusSchema = z.enum(['open', 'approved', 'denied']);
export type AppealStatus = z.infer<typeof AppealStatusSchema>;

export const AppealSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  modActionId: z.string().uuid().nullable(),
  message: z.string().min(1).max(2000),
  status: AppealStatusSchema,
  reviewNote: z.string().max(500).nullable(),
  reviewedBy: SnowflakeSchema.nullable(),
  reviewedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type Appeal = z.infer<typeof AppealSchema>;

export const CreateAppealSchema = z.object({
  userId: SnowflakeSchema,
  message: z.string().min(1).max(2000),
  modActionId: z.string().uuid().optional(),
});

export type CreateAppealInput = z.infer<typeof CreateAppealSchema>;

export const ReviewAppealSchema = z.object({
  status: z.enum(['approved', 'denied']),
  reviewedBy: SnowflakeSchema,
  reviewNote: z.string().max(500).optional(),
});

export type ReviewAppealInput = z.infer<typeof ReviewAppealSchema>;

// ─── Appeal SLA config ───────────────────────────────────────────────────

export const AppealSlaConfigSchema = z.object({
  guildId: SnowflakeSchema,
  warnHours: z.number().int().min(1).max(720),
  escalateChannelId: SnowflakeSchema.nullable(),
});

export type AppealSlaConfig = z.infer<typeof AppealSlaConfigSchema>;

export const UpsertAppealSlaConfigSchema = z.object({
  warnHours: z.number().int().min(1).max(720).optional(),
  escalateChannelId: SnowflakeSchema.nullable().optional(),
});

export type UpsertAppealSlaConfigInput = z.infer<typeof UpsertAppealSlaConfigSchema>;
