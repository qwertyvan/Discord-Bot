import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const GuildSchema = z.object({
  id: SnowflakeSchema,
  name: z.string().min(1).max(100),
  iconUrl: z.string().url().nullable(),
  addedAt: z.string().datetime(),
});

export type Guild = z.infer<typeof GuildSchema>;

export const GuildStatsSchema = z.object({
  guildId: SnowflakeSchema,
  warningCount: z.number().int().nonnegative(),
  warningsLast7d: z.number().int().nonnegative(),
  welcomeEnabled: z.boolean(),
});

export type GuildStats = z.infer<typeof GuildStatsSchema>;
