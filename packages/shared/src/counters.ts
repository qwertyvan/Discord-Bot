import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const CounterChannelTypeSchema = z.enum(['members', 'humans', 'bots', 'online', 'boosts']);
export type CounterChannelType = z.infer<typeof CounterChannelTypeSchema>;

export const CounterChannelSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  type: CounterChannelTypeSchema,
  template: z.string().min(1).max(64),
  updatedAt: z.string().datetime(),
});
export type CounterChannel = z.infer<typeof CounterChannelSchema>;

export const UpsertCounterChannelSchema = z.object({
  channelId: SnowflakeSchema,
  type: CounterChannelTypeSchema,
  template: z.string().min(1).max(64).optional(),
});
export type UpsertCounterChannelInput = z.infer<typeof UpsertCounterChannelSchema>;

export const VanityRoleKindSchema = z.enum(['color', 'badge']);
export type VanityRoleKind = z.infer<typeof VanityRoleKindSchema>;

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Hex color must be in #RRGGBB format.');

export const VanityRoleSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  roleId: SnowflakeSchema,
  name: z.string().min(1).max(64),
  kind: VanityRoleKindSchema,
  hexColor: HexColorSchema.nullable(),
  emoji: z.string().max(64).nullable(),
  createdAt: z.string().datetime(),
});
export type VanityRole = z.infer<typeof VanityRoleSchema>;

export const UpsertVanityRoleSchema = z.object({
  roleId: SnowflakeSchema,
  name: z.string().min(1).max(64),
  kind: VanityRoleKindSchema.default('color'),
  hexColor: HexColorSchema.optional(),
  emoji: z.string().max(64).optional(),
});
export type UpsertVanityRoleInput = z.infer<typeof UpsertVanityRoleSchema>;
