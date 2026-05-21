import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const ModNoteSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  moderatorId: SnowflakeSchema,
  content: z.string().min(1).max(1000),
  createdAt: z.string().datetime(),
});

export type ModNote = z.infer<typeof ModNoteSchema>;

export const CreateModNoteSchema = z.object({
  userId: SnowflakeSchema,
  moderatorId: SnowflakeSchema,
  content: z.string().min(1).max(1000),
});

export type CreateModNoteInput = z.infer<typeof CreateModNoteSchema>;
