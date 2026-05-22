import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// A clip in the per-guild soundboard library. `url` points to a streamable
// audio source — the bot fetches and pipes it into a voice channel.
export const SoundboardClipSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  name: z.string().min(1).max(64),
  url: z.string().url().max(2048),
  uploaderId: SnowflakeSchema.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
});

export type SoundboardClip = z.infer<typeof SoundboardClipSchema>;

export const UpsertSoundboardClipSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, 'Clip names must be alphanumeric with - or _.')
    .transform((s) => s.toLowerCase()),
  url: z.string().url().max(2048),
  uploaderId: SnowflakeSchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export type UpsertSoundboardClipInput = z.infer<typeof UpsertSoundboardClipSchema>;

export const TtsConfigSchema = z.object({
  guildId: SnowflakeSchema,
  welcomeText: z.string().max(500).nullable(),
  goodbyeText: z.string().max(500).nullable(),
  voiceChannelId: SnowflakeSchema.nullable(),
  language: z.string().min(2).max(8),
  enabled: z.boolean(),
});

export type TtsConfig = z.infer<typeof TtsConfigSchema>;

export const UpsertTtsConfigSchema = z.object({
  welcomeText: z.string().max(500).nullable().optional(),
  goodbyeText: z.string().max(500).nullable().optional(),
  voiceChannelId: SnowflakeSchema.nullable().optional(),
  language: z.string().min(2).max(8).optional(),
  enabled: z.boolean().optional(),
});

export type UpsertTtsConfigInput = z.infer<typeof UpsertTtsConfigSchema>;
