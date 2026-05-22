import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const StickyMessageSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  content: z.string().min(1).max(2000),
  lastMessageId: SnowflakeSchema.nullable(),
  throttleMessages: z.number().int().min(1).max(500),
  enabled: z.boolean(),
});

export type StickyMessage = z.infer<typeof StickyMessageSchema>;

export const UpsertStickyMessageSchema = z.object({
  channelId: SnowflakeSchema,
  content: z.string().min(1).max(2000),
  throttleMessages: z.number().int().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
});

export type UpsertStickyMessageInput = z.infer<typeof UpsertStickyMessageSchema>;

export const SuggestionStatusSchema = z.enum(['open', 'accepted', 'rejected', 'implemented']);
export type SuggestionStatus = z.infer<typeof SuggestionStatusSchema>;

export const SuggestionVoteSchema = z.object({
  suggestionId: z.string().uuid(),
  userId: SnowflakeSchema,
  vote: z.number().int().min(-1).max(1),
});

export type SuggestionVote = z.infer<typeof SuggestionVoteSchema>;

export const SuggestionSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema.nullable(),
  authorId: SnowflakeSchema,
  content: z.string().min(1).max(2000),
  status: SuggestionStatusSchema,
  reviewNote: z.string().max(500).nullable(),
  reviewedBy: SnowflakeSchema.nullable(),
  reviewedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  votes: z.object({ up: z.number().int().nonnegative(), down: z.number().int().nonnegative() }),
});

export type Suggestion = z.infer<typeof SuggestionSchema>;

export const CreateSuggestionSchema = z.object({
  channelId: SnowflakeSchema,
  authorId: SnowflakeSchema,
  content: z.string().min(1).max(2000),
});

export type CreateSuggestionInput = z.infer<typeof CreateSuggestionSchema>;

export const ReviewSuggestionSchema = z.object({
  status: SuggestionStatusSchema,
  reviewNote: z.string().max(500).optional(),
  reviewedBy: SnowflakeSchema,
});

export type ReviewSuggestionInput = z.infer<typeof ReviewSuggestionSchema>;

// Custom-embed builder body — used by both the bot post-embed admin route
// and the dashboard form. Keeps the surface area aligned with Discord's
// APIEmbed minus the things we don't render.
export const EmbedBuilderSchema = z.object({
  channelId: SnowflakeSchema,
  title: z.string().max(256).optional(),
  description: z.string().max(4000).optional(),
  url: z.string().url().optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  imageUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  footer: z.string().max(2048).optional(),
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        value: z.string().min(1).max(1024),
        inline: z.boolean().optional(),
      }),
    )
    .max(25)
    .optional(),
});

export type EmbedBuilderInput = z.infer<typeof EmbedBuilderSchema>;
