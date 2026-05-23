import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Objective kinds the bot can auto-progress against. `send_in_channel`
// requires `targetChannelId` on the template; `complete_other_quest` is
// driven by the API itself (each claim emits a progress event with that
// kind so chained-quest templates can advance).
export const QuestKindSchema = z.enum([
  'send_messages',
  'react_messages',
  'send_in_channel',
  'voice_minutes',
  'send_image',
  'complete_other_quest',
]);
export type QuestKind = z.infer<typeof QuestKindSchema>;

export const QuestCadenceSchema = z.enum(['daily', 'weekly']);
export type QuestCadence = z.infer<typeof QuestCadenceSchema>;

export const QuestTemplateSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  slug: z.string().min(1).max(48),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  kind: QuestKindSchema,
  targetCount: z.number().int().positive(),
  targetChannelId: SnowflakeSchema.nullable(),
  cadence: QuestCadenceSchema,
  rewardCurrency: z.number().int().nonnegative(),
  rewardXp: z.number().int().nonnegative(),
  rewardRoleId: SnowflakeSchema.nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type QuestTemplate = z.infer<typeof QuestTemplateSchema>;

export const CreateQuestTemplateSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric or dashes'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  kind: QuestKindSchema,
  targetCount: z.number().int().positive().max(100_000).default(1),
  targetChannelId: SnowflakeSchema.optional(),
  cadence: QuestCadenceSchema,
  rewardCurrency: z.number().int().nonnegative().max(1_000_000).default(0),
  rewardXp: z.number().int().nonnegative().max(1_000_000).default(0),
  rewardRoleId: SnowflakeSchema.optional(),
  enabled: z.boolean().default(true),
});
export type CreateQuestTemplateInput = z.infer<typeof CreateQuestTemplateSchema>;

export const UpdateQuestTemplateSchema = CreateQuestTemplateSchema.partial();
export type UpdateQuestTemplateInput = z.infer<typeof UpdateQuestTemplateSchema>;

export const UserQuestSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  templateId: z.string().uuid(),
  template: QuestTemplateSchema,
  progress: z.number().int().nonnegative(),
  completedAt: z.string().datetime().nullable(),
  claimedAt: z.string().datetime().nullable(),
  periodStartedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type UserQuest = z.infer<typeof UserQuestSchema>;

// Body of POST /guilds/:gid/user-quests/progress. The API resolves which
// active UserQuest rows are affected by this event (matching kind +
// optional channelId) and increments progress for each.
export const ProgressEventSchema = z.object({
  userId: SnowflakeSchema,
  kind: QuestKindSchema,
  channelId: SnowflakeSchema.optional(),
  delta: z.number().int().positive().max(1000).default(1),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
