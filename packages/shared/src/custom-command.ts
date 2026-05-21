import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Discord slash-command name regex (must be lowercase; 1-32 chars).
const DISCORD_NAME = /^[a-z0-9_-]{1,32}$/;

export const CustomCommandSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  name: z.string().min(1).max(32).regex(DISCORD_NAME),
  description: z.string().min(1).max(100),
  response: z.string().min(1).max(2000),
  createdBy: SnowflakeSchema,
  uses: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CustomCommand = z.infer<typeof CustomCommandSchema>;

export const CreateCustomCommandSchema = z.object({
  name: z.string().min(1).max(32).regex(DISCORD_NAME).transform((s) => s.toLowerCase()),
  description: z.string().min(1).max(100),
  response: z.string().min(1).max(2000),
  createdBy: SnowflakeSchema,
});

export type CreateCustomCommandInput = z.infer<typeof CreateCustomCommandSchema>;

export const UpdateCustomCommandSchema = z.object({
  description: z.string().min(1).max(100).optional(),
  response: z.string().min(1).max(2000).optional(),
});

export type UpdateCustomCommandInput = z.infer<typeof UpdateCustomCommandSchema>;
