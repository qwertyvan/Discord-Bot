import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const AuditEventTypeSchema = z.enum([
  'MESSAGE_DELETE',
  'MESSAGE_EDIT',
  'MEMBER_JOIN',
  'MEMBER_LEAVE',
  'MEMBER_ROLE_ADD',
  'MEMBER_ROLE_REMOVE',
  'MEMBER_NICKNAME_CHANGE',
  'CHANNEL_CREATE',
  'CHANNEL_DELETE',
  'VOICE_JOIN',
  'VOICE_LEAVE',
  'MOD_ACTION',
]);

export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  type: AuditEventTypeSchema,
  userId: SnowflakeSchema.nullable(),
  channelId: SnowflakeSchema.nullable(),
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const CreateAuditEventSchema = z.object({
  type: AuditEventTypeSchema,
  userId: SnowflakeSchema.optional(),
  channelId: SnowflakeSchema.optional(),
  payload: z.record(z.unknown()).optional(),
});

export type CreateAuditEventInput = z.infer<typeof CreateAuditEventSchema>;

export const LoggingConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  channelId: SnowflakeSchema.nullable(),
  events: z.record(AuditEventTypeSchema, z.boolean()),
});

export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

export const UpdateLoggingConfigSchema = z.object({
  enabled: z.boolean().optional(),
  channelId: SnowflakeSchema.nullable().optional(),
  events: z.record(AuditEventTypeSchema, z.boolean()).optional(),
});

export type UpdateLoggingConfigInput = z.infer<typeof UpdateLoggingConfigSchema>;
