import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const VerificationConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  channelId: SnowflakeSchema.nullable(),
  messageId: SnowflakeSchema.nullable(),
  verifiedRoleId: SnowflakeSchema.nullable(),
  buttonLabel: z.string().min(1).max(80).nullable(),
  prompt: z.string().min(1).max(2000).nullable(),
});

export type VerificationConfig = z.infer<typeof VerificationConfigSchema>;

export const UpdateVerificationConfigSchema = VerificationConfigSchema.omit({ guildId: true })
  .partial();
export type UpdateVerificationConfigInput = z.infer<typeof UpdateVerificationConfigSchema>;
