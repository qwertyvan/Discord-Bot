import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const ReactionRoleOptionSchema = z.object({
  id: z.string().uuid(),
  panelId: z.string().uuid(),
  roleId: SnowflakeSchema,
  label: z.string().min(1).max(80),
  description: z.string().max(100).nullable(),
  emoji: z.string().max(64).nullable(),
  position: z.number().int().nonnegative(),
});

export type ReactionRoleOption = z.infer<typeof ReactionRoleOptionSchema>;

export const ReactionRolePanelSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema.nullable(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable(),
  exclusive: z.boolean(),
  useDropdown: z.boolean(),
  options: z.array(ReactionRoleOptionSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ReactionRolePanel = z.infer<typeof ReactionRolePanelSchema>;

export const CreateReactionRoleOptionSchema = z.object({
  roleId: SnowflakeSchema,
  label: z.string().min(1).max(80),
  description: z.string().max(100).optional(),
  emoji: z.string().max(64).optional(),
  position: z.number().int().nonnegative().optional(),
});

export type CreateReactionRoleOptionInput = z.infer<typeof CreateReactionRoleOptionSchema>;

export const CreateReactionRolePanelSchema = z.object({
  channelId: SnowflakeSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  exclusive: z.boolean().optional(),
  useDropdown: z.boolean().optional(),
  options: z.array(CreateReactionRoleOptionSchema).min(1).max(25),
});

export type CreateReactionRolePanelInput = z.infer<typeof CreateReactionRolePanelSchema>;

export const UpdateReactionRolePanelSchema = CreateReactionRolePanelSchema.partial().extend({
  messageId: SnowflakeSchema.nullable().optional(),
});
export type UpdateReactionRolePanelInput = z.infer<typeof UpdateReactionRolePanelSchema>;
