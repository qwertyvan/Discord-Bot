import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Discord emoji input: either a unicode glyph or a custom-emoji token in the
// shape `<:name:id>` / `<a:name:id>` (animated). We keep validation loose so
// arbitrary unicode (incl. ZWJ sequences) passes.
const EmojiSchema = z.string().min(1).max(80);

export const AutoReactionRuleSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  // null = applies to every channel in the guild
  channelId: SnowflakeSchema.nullable(),
  pattern: z.string().min(1).max(200),
  isRegex: z.boolean(),
  caseSensitive: z.boolean(),
  emojis: z.array(EmojiSchema).min(1).max(3),
  enabled: z.boolean(),
  createdBy: SnowflakeSchema,
  createdAt: z.string().datetime(),
});

export type AutoReactionRule = z.infer<typeof AutoReactionRuleSchema>;

export const CreateAutoReactionRuleSchema = z.object({
  channelId: SnowflakeSchema.nullable().optional(),
  pattern: z.string().min(1).max(200),
  isRegex: z.boolean().default(false),
  caseSensitive: z.boolean().default(false),
  emojis: z.array(EmojiSchema).min(1).max(3),
  enabled: z.boolean().default(true),
  createdBy: SnowflakeSchema,
});

export type CreateAutoReactionRuleInput = z.infer<typeof CreateAutoReactionRuleSchema>;

export const UpdateAutoReactionRuleSchema = z.object({
  channelId: SnowflakeSchema.nullable().optional(),
  pattern: z.string().min(1).max(200).optional(),
  isRegex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  emojis: z.array(EmojiSchema).min(1).max(3).optional(),
  enabled: z.boolean().optional(),
});

export type UpdateAutoReactionRuleInput = z.infer<typeof UpdateAutoReactionRuleSchema>;
