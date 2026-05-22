import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// ─── Forum auto-tag rules ─────────────────────────────────────────────────
export const ForumAutoTagSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  keyword: z.string().min(1).max(120),
  tagId: z.string().min(1).max(40),
  createdAt: z.string().datetime(),
});

export type ForumAutoTag = z.infer<typeof ForumAutoTagSchema>;

export const UpsertForumAutoTagSchema = z.object({
  channelId: SnowflakeSchema,
  keyword: z.string().min(1).max(120),
  tagId: z.string().min(1).max(40),
});

export type UpsertForumAutoTagInput = z.infer<typeof UpsertForumAutoTagSchema>;

// ─── Stale-thread policy ──────────────────────────────────────────────────
export const StaleThreadActionSchema = z.enum(['archive', 'lock']);
export type StaleThreadAction = z.infer<typeof StaleThreadActionSchema>;

export const StaleThreadPolicySchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  idleHours: z.number().int().min(1).max(24 * 30),
  action: StaleThreadActionSchema,
});

export type StaleThreadPolicy = z.infer<typeof StaleThreadPolicySchema>;

export const UpsertStalePolicySchema = z.object({
  enabled: z.boolean().optional(),
  idleHours: z.number().int().min(1).max(24 * 30).optional(),
  action: StaleThreadActionSchema.optional(),
});

export type UpsertStalePolicyInput = z.infer<typeof UpsertStalePolicySchema>;

// ─── Scheduled Stage events ───────────────────────────────────────────────
export const StageEventStatusSchema = z.enum(['scheduled', 'live', 'ended', 'cancelled']);
export type StageEventStatus = z.infer<typeof StageEventStatusSchema>;

export const StageScheduledEventSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  topic: z.string().min(1).max(120),
  scheduledFor: z.string().datetime(),
  speakerIds: z.array(SnowflakeSchema),
  recapChannelId: SnowflakeSchema.nullable(),
  status: StageEventStatusSchema,
  createdAt: z.string().datetime(),
});

export type StageScheduledEvent = z.infer<typeof StageScheduledEventSchema>;

export const CreateStageEventSchema = z.object({
  channelId: SnowflakeSchema,
  topic: z.string().min(1).max(120),
  scheduledFor: z.string().datetime(),
  speakerIds: z.array(SnowflakeSchema).max(10).optional(),
  recapChannelId: SnowflakeSchema.optional(),
});

export type CreateStageEventInput = z.infer<typeof CreateStageEventSchema>;
