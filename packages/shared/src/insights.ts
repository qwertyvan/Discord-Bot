import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// One row from the per-guild daily aggregate. `day` is an ISO date
// (YYYY-MM-DD) in UTC.
export const ActivitySnapshotSchema = z.object({
  guildId: SnowflakeSchema,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  joins: z.number().int().nonnegative(),
  leaves: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  voiceMinutes: z.number().int().nonnegative(),
});

export type ActivitySnapshot = z.infer<typeof ActivitySnapshotSchema>;

export const ChannelDailyActivitySchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  messages: z.number().int().nonnegative(),
});

export type ChannelDailyActivity = z.infer<typeof ChannelDailyActivitySchema>;

// Bot → API batch payload. The bot accumulates counts in memory and flushes
// the dirty buckets every ~60s. Numbers are *deltas* to add to the row, not
// absolute totals. `channelMessages` accumulates per-channel deltas for the
// same day so the API can update both tables in a single request.
export const ActivityEventsBatchSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  joins: z.number().int().min(0).max(100_000).optional(),
  leaves: z.number().int().min(0).max(100_000).optional(),
  messages: z.number().int().min(0).max(1_000_000).optional(),
  voiceMinutes: z.number().int().min(0).max(1_000_000).optional(),
  channelMessages: z
    .array(
      z.object({
        channelId: SnowflakeSchema,
        count: z.number().int().min(1).max(1_000_000),
      }),
    )
    .max(1000)
    .default([]),
});

export type ActivityEventsBatchInput = z.infer<typeof ActivityEventsBatchSchema>;

// Per-day point on the chart returned by /guilds/:gid/insights.
export const InsightsSeriesPointSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  joins: z.number().int().nonnegative(),
  leaves: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  voiceMinutes: z.number().int().nonnegative(),
});

export type InsightsSeriesPoint = z.infer<typeof InsightsSeriesPointSchema>;

export const InsightsTopChannelSchema = z.object({
  channelId: SnowflakeSchema,
  messages: z.number().int().nonnegative(),
});

export type InsightsTopChannel = z.infer<typeof InsightsTopChannelSchema>;

export const InsightsSummarySchema = z.object({
  guildId: SnowflakeSchema,
  days: z.number().int().positive(),
  series: z.array(InsightsSeriesPointSchema),
  totals: z.object({
    joins: z.number().int().nonnegative(),
    leaves: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    voiceMinutes: z.number().int().nonnegative(),
  }),
  topChannels: z.array(InsightsTopChannelSchema),
});

export type InsightsSummary = z.infer<typeof InsightsSummarySchema>;
