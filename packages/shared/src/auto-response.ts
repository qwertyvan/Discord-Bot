import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const AutoResponseMatchTypeSchema = z.enum(['contains', 'word', 'exact']);
export type AutoResponseMatchType = z.infer<typeof AutoResponseMatchTypeSchema>;

export const AutoResponseSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  trigger: z.string().min(1).max(200),
  matchType: AutoResponseMatchTypeSchema,
  caseSensitive: z.boolean(),
  response: z.string().min(1).max(2000),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AutoResponse = z.infer<typeof AutoResponseSchema>;

export const CreateAutoResponseSchema = z.object({
  trigger: z.string().min(1).max(200),
  matchType: AutoResponseMatchTypeSchema.default('contains'),
  caseSensitive: z.boolean().default(false),
  response: z.string().min(1).max(2000),
  enabled: z.boolean().default(true),
});

export type CreateAutoResponseInput = z.infer<typeof CreateAutoResponseSchema>;

export const UpdateAutoResponseSchema = CreateAutoResponseSchema.partial();
export type UpdateAutoResponseInput = z.infer<typeof UpdateAutoResponseSchema>;
