import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const ScheduledAnnouncementSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  content: z.string().max(2000).nullable(),
  embedJson: z.record(z.unknown()).nullable(),
  runAt: z.string().datetime(),
  repeatEvery: z.number().int().min(60).max(365 * 86_400).nullable(),
  lastRunAt: z.string().datetime().nullable(),
  enabled: z.boolean(),
  createdBy: SnowflakeSchema,
  createdAt: z.string().datetime(),
});

export type ScheduledAnnouncement = z.infer<typeof ScheduledAnnouncementSchema>;

export const CreateScheduledAnnouncementSchema = z.object({
  channelId: SnowflakeSchema,
  content: z.string().max(2000).optional(),
  embedJson: z.record(z.unknown()).optional(),
  runAt: z.string().datetime(),
  repeatEvery: z.number().int().min(60).max(365 * 86_400).optional(),
  createdBy: SnowflakeSchema,
});

export type CreateScheduledAnnouncementInput = z.infer<typeof CreateScheduledAnnouncementSchema>;

export const BirthdayConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  channelId: SnowflakeSchema.nullable(),
  template: z.string().min(1).max(500).nullable(),
  announceHour: z.number().int().min(0).max(23),
});

export type BirthdayConfig = z.infer<typeof BirthdayConfigSchema>;

export const UpdateBirthdayConfigSchema = BirthdayConfigSchema.omit({ guildId: true }).partial();
export type UpdateBirthdayConfigInput = z.infer<typeof UpdateBirthdayConfigSchema>;

export const UserBirthdaySchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().min(1900).max(2100).nullable(),
});

export type UserBirthday = z.infer<typeof UserBirthdaySchema>;

export const SetUserBirthdaySchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().min(1900).max(2100).optional(),
});

export type SetUserBirthdayInput = z.infer<typeof SetUserBirthdaySchema>;

export const EventRsvpStatusSchema = z.enum(['yes', 'maybe', 'no']);
export type EventRsvpStatus = z.infer<typeof EventRsvpStatusSchema>;

export const EventRsvpSchema = z.object({
  eventId: z.string().uuid(),
  userId: SnowflakeSchema,
  status: EventRsvpStatusSchema,
  respondedAt: z.string().datetime(),
});

export type EventRsvp = z.infer<typeof EventRsvpSchema>;

export const EventSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema.nullable(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable(),
  location: z.string().max(200).nullable(),
  createdBy: SnowflakeSchema,
  createdAt: z.string().datetime(),
  rsvps: z.array(EventRsvpSchema),
  counts: z.object({
    yes: z.number().int().nonnegative(),
    maybe: z.number().int().nonnegative(),
    no: z.number().int().nonnegative(),
  }),
});

export type Event = z.infer<typeof EventSchema>;

export const CreateEventSchema = z.object({
  channelId: SnowflakeSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  location: z.string().max(200).optional(),
  createdBy: SnowflakeSchema,
});

export type CreateEventInput = z.infer<typeof CreateEventSchema>;
