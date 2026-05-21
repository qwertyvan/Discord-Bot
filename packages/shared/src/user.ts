import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const DiscordUserSchema = z.object({
  id: SnowflakeSchema,
  username: z.string().min(1),
  globalName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
});

export type DiscordUser = z.infer<typeof DiscordUserSchema>;
