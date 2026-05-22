import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// "all" — every voice channel is claimable; "listed" — only those rows in
// VoiceClaimableChannel are claimable. Mirrors the Prisma string column.
export const VoiceClaimModeSchema = z.enum(['all', 'listed']);
export type VoiceClaimMode = z.infer<typeof VoiceClaimModeSchema>;

export const VoiceClaimConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  mode: VoiceClaimModeSchema,
});
export type VoiceClaimConfig = z.infer<typeof VoiceClaimConfigSchema>;

export const UpsertVoiceClaimConfigSchema = z
  .object({
    enabled: z.boolean(),
    mode: VoiceClaimModeSchema,
  })
  .partial();
export type UpsertVoiceClaimConfigInput = z.infer<typeof UpsertVoiceClaimConfigSchema>;

export const VoiceClaimableChannelSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
});
export type VoiceClaimableChannel = z.infer<typeof VoiceClaimableChannelSchema>;

export const CreateVoiceClaimableChannelSchema = z.object({
  channelId: SnowflakeSchema,
});
export type CreateVoiceClaimableChannelInput = z.infer<typeof CreateVoiceClaimableChannelSchema>;

export const VoiceClaimSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  ownerId: SnowflakeSchema,
  claimedAt: z.string().datetime(),
  lockedAt: z.string().datetime().nullable(),
});
export type VoiceClaim = z.infer<typeof VoiceClaimSchema>;

export const CreateVoiceClaimSchema = z.object({
  channelId: SnowflakeSchema,
  ownerId: SnowflakeSchema,
});
export type CreateVoiceClaimInput = z.infer<typeof CreateVoiceClaimSchema>;

export const UpdateVoiceClaimSchema = z.object({
  lockedAt: z.string().datetime().nullable().optional(),
});
export type UpdateVoiceClaimInput = z.infer<typeof UpdateVoiceClaimSchema>;
