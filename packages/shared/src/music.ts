import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const LoopModeSchema = z.enum(['off', 'track', 'queue']);
export type LoopMode = z.infer<typeof LoopModeSchema>;

export const MusicTrackSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  position: z.number().int().nonnegative(),
  title: z.string().min(1).max(300),
  url: z.string().url().max(2048),
  durationSec: z.number().int().nonnegative().nullable(),
  requesterId: SnowflakeSchema,
  addedAt: z.string().datetime(),
});

export type MusicTrack = z.infer<typeof MusicTrackSchema>;

export const MusicQueueSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema.nullable(),
  currentIndex: z.number().int().nonnegative(),
  volume: z.number().int().min(0).max(100),
  loopMode: LoopModeSchema,
  updatedAt: z.string().datetime(),
  tracks: z.array(MusicTrackSchema),
});

export type MusicQueue = z.infer<typeof MusicQueueSchema>;

export const AddTrackSchema = z.object({
  title: z.string().min(1).max(300),
  url: z.string().url().max(2048),
  durationSec: z.number().int().nonnegative().optional(),
  requesterId: SnowflakeSchema,
});

export type AddTrackInput = z.infer<typeof AddTrackSchema>;

export const MoveTrackSchema = z.object({
  fromPosition: z.number().int().nonnegative(),
  toPosition: z.number().int().nonnegative(),
});

export type MoveTrackInput = z.infer<typeof MoveTrackSchema>;

export const SetQueueStateSchema = z.object({
  channelId: SnowflakeSchema.nullable().optional(),
  currentIndex: z.number().int().nonnegative().optional(),
  volume: z.number().int().min(0).max(100).optional(),
  loopMode: LoopModeSchema.optional(),
  // When true the server shuffles the tracks after position currentIndex.
  shuffle: z.boolean().optional(),
});

export type SetQueueStateInput = z.infer<typeof SetQueueStateSchema>;
