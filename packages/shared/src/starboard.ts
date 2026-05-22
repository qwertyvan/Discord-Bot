import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const StarboardConfigSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema.nullable(),
  threshold: z.number().int().min(1).max(100),
  emoji: z.string().min(1).max(64),
  allowNsfw: z.boolean(),
  enabled: z.boolean(),
  updatedAt: z.string().datetime(),
});

export type StarboardConfig = z.infer<typeof StarboardConfigSchema>;

export const UpsertStarboardConfigSchema = z.object({
  channelId: SnowflakeSchema.nullable().optional(),
  threshold: z.number().int().min(1).max(100).optional(),
  emoji: z.string().min(1).max(64).optional(),
  allowNsfw: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export type UpsertStarboardConfigInput = z.infer<typeof UpsertStarboardConfigSchema>;

export const StarboardEntrySchema = z.object({
  sourceMessageId: SnowflakeSchema,
  starboardMessageId: SnowflakeSchema.nullable(),
  guildId: SnowflakeSchema,
  authorId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  starCount: z.number().int().nonnegative(),
  content: z.string().max(2000),
  attachmentUrl: z.string().max(2048).nullable(),
  firstStarredAt: z.string().datetime(),
});

export type StarboardEntry = z.infer<typeof StarboardEntrySchema>;

// Bot reports the current observed reaction count for a source message. The
// API upserts: on insert, content/author/channel are required; on update, the
// star count is set to the reported value (the bot is the source of truth).
export const RecordStarSchema = z.object({
  sourceMessageId: SnowflakeSchema,
  authorId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  starCount: z.number().int().nonnegative(),
  content: z.string().max(2000),
  attachmentUrl: z.string().max(2048).nullable().optional(),
});

export type RecordStarInput = z.infer<typeof RecordStarSchema>;

export const SetStarboardMessageIdSchema = z.object({
  starboardMessageId: SnowflakeSchema.nullable(),
});

export type SetStarboardMessageIdInput = z.infer<typeof SetStarboardMessageIdSchema>;
