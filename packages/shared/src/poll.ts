import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const PollOptionSchema = z.object({
  id: z.string().uuid(),
  pollId: z.string().uuid(),
  label: z.string().min(1).max(80),
  position: z.number().int().nonnegative(),
  voteCount: z.number().int().nonnegative(),
});

export type PollOption = z.infer<typeof PollOptionSchema>;

export const PollSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema.nullable(),
  authorId: SnowflakeSchema,
  question: z.string().min(1).max(300),
  anonymous: z.boolean(),
  multiSelect: z.boolean(),
  closesAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  options: z.array(PollOptionSchema),
  totalVotes: z.number().int().nonnegative(),
});

export type Poll = z.infer<typeof PollSchema>;

export const CreatePollSchema = z.object({
  channelId: SnowflakeSchema,
  authorId: SnowflakeSchema,
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(80)).min(2).max(10),
  anonymous: z.boolean().optional(),
  multiSelect: z.boolean().optional(),
  closesAt: z.string().datetime().optional(),
});

export type CreatePollInput = z.infer<typeof CreatePollSchema>;

export const VotePollSchema = z.object({
  userId: SnowflakeSchema,
  optionIds: z.array(z.string().uuid()).min(0).max(10),
});

export type VotePollInput = z.infer<typeof VotePollSchema>;
