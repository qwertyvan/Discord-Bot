import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Discord invite codes are short alphanumeric strings (2–10 chars typical;
// vanity URLs can be longer). We allow up to 32 for safety.
const InviteCodeStringSchema = z.string().min(1).max(32);

export const InviteCodeSchema = z.object({
  code: InviteCodeStringSchema,
  guildId: SnowflakeSchema,
  inviterId: SnowflakeSchema.nullable(),
  channelId: SnowflakeSchema.nullable(),
  maxUses: z.number().int().min(0).nullable(),
  uses: z.number().int().min(0),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type InviteCode = z.infer<typeof InviteCodeSchema>;

export const UpsertInviteCodeSchema = z.object({
  code: InviteCodeStringSchema,
  inviterId: SnowflakeSchema.nullable().optional(),
  channelId: SnowflakeSchema.nullable().optional(),
  maxUses: z.number().int().min(0).nullable().optional(),
  uses: z.number().int().min(0).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export type UpsertInviteCodeInput = z.infer<typeof UpsertInviteCodeSchema>;

export const MemberInviteSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  inviterId: SnowflakeSchema.nullable(),
  inviteCode: InviteCodeStringSchema.nullable(),
  joinedAt: z.string().datetime(),
  leftAt: z.string().datetime().nullable(),
  isFake: z.boolean(),
});

export type MemberInvite = z.infer<typeof MemberInviteSchema>;

export const CreateMemberInviteSchema = z.object({
  userId: SnowflakeSchema,
  inviterId: SnowflakeSchema.nullable().optional(),
  inviteCode: InviteCodeStringSchema.nullable().optional(),
});

export type CreateMemberInviteInput = z.infer<typeof CreateMemberInviteSchema>;

export const UpdateMemberInviteSchema = z.object({
  leftAt: z.string().datetime().nullable().optional(),
  isFake: z.boolean().optional(),
});

export type UpdateMemberInviteInput = z.infer<typeof UpdateMemberInviteSchema>;

export const InviteGatedRoleSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  inviteCode: InviteCodeStringSchema,
  roleId: SnowflakeSchema,
});

export type InviteGatedRole = z.infer<typeof InviteGatedRoleSchema>;

export const UpsertInviteGatedRoleSchema = z.object({
  inviteCode: InviteCodeStringSchema,
  roleId: SnowflakeSchema,
});

export type UpsertInviteGatedRoleInput = z.infer<typeof UpsertInviteGatedRoleSchema>;

export const InviterLeaderboardEntrySchema = z.object({
  inviterId: SnowflakeSchema,
  real: z.number().int().min(0),
  fake: z.number().int().min(0),
  total: z.number().int().min(0),
});

export type InviterLeaderboardEntry = z.infer<typeof InviterLeaderboardEntrySchema>;
