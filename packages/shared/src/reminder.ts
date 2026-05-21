import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const ReminderSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema.nullable(),
  userId: SnowflakeSchema,
  channelId: SnowflakeSchema.nullable(),
  content: z.string().min(1).max(500),
  runAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type Reminder = z.infer<typeof ReminderSchema>;

export const CreateReminderSchema = z.object({
  guildId: SnowflakeSchema.optional(),
  userId: SnowflakeSchema,
  channelId: SnowflakeSchema.optional(),
  content: z.string().min(1).max(500),
  runAt: z.string().datetime(),
});

export type CreateReminderInput = z.infer<typeof CreateReminderSchema>;
