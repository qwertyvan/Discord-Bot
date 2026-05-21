import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const WarningSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  moderatorId: SnowflakeSchema,
  reason: z.string().min(1).max(500),
  createdAt: z.string().datetime(),
});

export type Warning = z.infer<typeof WarningSchema>;

export const CreateWarningSchema = z.object({
  userId: SnowflakeSchema,
  moderatorId: SnowflakeSchema,
  reason: z.string().min(1).max(500),
});

export type CreateWarningInput = z.infer<typeof CreateWarningSchema>;

export const WarningListQuerySchema = z.object({
  userId: SnowflakeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

export type WarningListQuery = z.infer<typeof WarningListQuerySchema>;
