import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const KaraokeNightStatusSchema = z.enum(['scheduled', 'live', 'ended', 'cancelled']);
export type KaraokeNightStatus = z.infer<typeof KaraokeNightStatusSchema>;

export const KaraokeRsvpStatusSchema = z.enum(['yes', 'maybe', 'no']);
export type KaraokeRsvpStatus = z.infer<typeof KaraokeRsvpStatusSchema>;

export const KaraokeSongSchema = z.object({
  id: z.string().uuid(),
  nightId: z.string().uuid(),
  submitterId: SnowflakeSchema,
  title: z.string().min(1).max(200),
  url: z.string().max(2048).nullable(),
  notes: z.string().max(500).nullable(),
  playedAt: z.string().datetime().nullable(),
  position: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export type KaraokeSong = z.infer<typeof KaraokeSongSchema>;

export const CreateKaraokeSongSchema = z.object({
  submitterId: SnowflakeSchema,
  title: z.string().min(1).max(200),
  url: z.string().url().max(2048).optional(),
  notes: z.string().max(500).optional(),
});

export type CreateKaraokeSongInput = z.infer<typeof CreateKaraokeSongSchema>;

export const UpdateKaraokeSongSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  url: z.string().url().max(2048).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
  played: z.boolean().optional(),
});

export type UpdateKaraokeSongInput = z.infer<typeof UpdateKaraokeSongSchema>;

export const KaraokeRsvpSchema = z.object({
  nightId: z.string().uuid(),
  userId: SnowflakeSchema,
  status: KaraokeRsvpStatusSchema,
  rsvpAt: z.string().datetime(),
});

export type KaraokeRsvp = z.infer<typeof KaraokeRsvpSchema>;

export const UpsertKaraokeRsvpSchema = z.object({
  userId: SnowflakeSchema,
  status: KaraokeRsvpStatusSchema,
});

export type UpsertKaraokeRsvpInput = z.infer<typeof UpsertKaraokeRsvpSchema>;

export const KaraokeNightSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  voiceChannelId: SnowflakeSchema,
  hostId: SnowflakeSchema,
  title: z.string().min(1).max(120),
  scheduledFor: z.string().datetime(),
  status: KaraokeNightStatusSchema,
  announceChannelId: SnowflakeSchema.nullable(),
  recapChannelId: SnowflakeSchema.nullable(),
  announcedT15: z.boolean(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  // Optional aggregated fields populated by the detail endpoint.
  songs: z.array(KaraokeSongSchema).optional(),
  rsvps: z.array(KaraokeRsvpSchema).optional(),
  rsvpCounts: z
    .object({
      yes: z.number().int().nonnegative(),
      maybe: z.number().int().nonnegative(),
      no: z.number().int().nonnegative(),
    })
    .optional(),
});

export type KaraokeNight = z.infer<typeof KaraokeNightSchema>;

export const CreateKaraokeNightSchema = z.object({
  voiceChannelId: SnowflakeSchema,
  hostId: SnowflakeSchema,
  title: z.string().min(1).max(120),
  scheduledFor: z.string().datetime(),
  announceChannelId: SnowflakeSchema.optional(),
  recapChannelId: SnowflakeSchema.optional(),
});

export type CreateKaraokeNightInput = z.infer<typeof CreateKaraokeNightSchema>;

export const UpdateKaraokeNightSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  scheduledFor: z.string().datetime().optional(),
  voiceChannelId: SnowflakeSchema.optional(),
  hostId: SnowflakeSchema.optional(),
  announceChannelId: SnowflakeSchema.nullable().optional(),
  recapChannelId: SnowflakeSchema.nullable().optional(),
  status: KaraokeNightStatusSchema.optional(),
  announcedT15: z.boolean().optional(),
});

export type UpdateKaraokeNightInput = z.infer<typeof UpdateKaraokeNightSchema>;
