import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// A configured join-to-create hub. When a user joins this channel, the bot
// spawns a fresh child voice channel for them and moves them in.
export const VoiceHubChannelSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  namePattern: z.string().min(1).max(64),
  userLimit: z.number().int().min(0).max(99).nullable(),
  categoryId: SnowflakeSchema.nullable(),
  autoDelete: z.boolean(),
  createdAt: z.string().datetime(),
});

export type VoiceHubChannel = z.infer<typeof VoiceHubChannelSchema>;

export const UpsertVoiceHubSchema = z.object({
  channelId: SnowflakeSchema,
  namePattern: z.string().min(1).max(64),
  userLimit: z.number().int().min(0).max(99).nullable().optional(),
  categoryId: SnowflakeSchema.nullable().optional(),
  autoDelete: z.boolean().optional(),
});

export type UpsertVoiceHubInput = z.infer<typeof UpsertVoiceHubSchema>;

export const VoiceSessionSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  joinedAt: z.string().datetime(),
  leftAt: z.string().datetime().nullable(),
});

export type VoiceSession = z.infer<typeof VoiceSessionSchema>;

export const StartVoiceSessionSchema = z.object({
  userId: SnowflakeSchema,
  channelId: SnowflakeSchema,
});

export type StartVoiceSessionInput = z.infer<typeof StartVoiceSessionSchema>;
