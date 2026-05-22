import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const QuoteSavePermissionSchema = z.enum(['everyone', 'trusted-role', 'mods']);
export type QuoteSavePermission = z.infer<typeof QuoteSavePermissionSchema>;

export const QuoteConfigSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema.nullable(),
  savePermission: QuoteSavePermissionSchema,
  trustedRoleId: SnowflakeSchema.nullable(),
  weeklyDigest: z.boolean(),
});

export type QuoteConfig = z.infer<typeof QuoteConfigSchema>;

export const UpsertQuoteConfigSchema = z.object({
  channelId: SnowflakeSchema.nullable().optional(),
  savePermission: QuoteSavePermissionSchema.optional(),
  trustedRoleId: SnowflakeSchema.nullable().optional(),
  weeklyDigest: z.boolean().optional(),
});

export type UpsertQuoteConfigInput = z.infer<typeof UpsertQuoteConfigSchema>;

export const QuoteSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  sourceMessageId: SnowflakeSchema,
  sourceChannelId: SnowflakeSchema,
  authorId: SnowflakeSchema,
  savedBy: SnowflakeSchema,
  content: z.string().max(2000),
  attachmentUrl: z.string().max(2048).nullable(),
  savedAt: z.string().datetime(),
  reactionCount: z.number().int().nonnegative(),
});

export type Quote = z.infer<typeof QuoteSchema>;

export const CreateQuoteSchema = z.object({
  sourceMessageId: SnowflakeSchema,
  sourceChannelId: SnowflakeSchema,
  authorId: SnowflakeSchema,
  savedBy: SnowflakeSchema,
  content: z.string().min(1).max(2000),
  attachmentUrl: z.string().max(2048).optional(),
  reactionCount: z.number().int().nonnegative().optional(),
});

export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>;

export const QuoteListQuerySchema = z.object({
  authorId: SnowflakeSchema.optional(),
  savedBy: SnowflakeSchema.optional(),
  search: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type QuoteListQuery = z.infer<typeof QuoteListQuerySchema>;

export const QuoteTopQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

export type QuoteTopQuery = z.infer<typeof QuoteTopQuerySchema>;
