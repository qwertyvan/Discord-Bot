import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const TagSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  name: z.string().min(1).max(64),
  content: z.string().min(1).max(2000),
  authorId: SnowflakeSchema,
  uses: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Tag = z.infer<typeof TagSchema>;

// Tag names: lowercase, alphanumeric, dashes and underscores. 1-64 chars.
export const TagNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_-]+$/i, 'Tag names may only contain letters, digits, underscores, and dashes.')
  .transform((s) => s.toLowerCase());

export const CreateTagSchema = z.object({
  name: TagNameSchema,
  content: z.string().min(1).max(2000),
  authorId: SnowflakeSchema,
});

export type CreateTagInput = z.infer<typeof CreateTagSchema>;

export const UpdateTagSchema = z.object({
  content: z.string().min(1).max(2000),
});

export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;
