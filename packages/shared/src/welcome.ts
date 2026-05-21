import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

/**
 * Placeholders accepted in welcome/leave templates:
 *   {user}         — mention of the joining/leaving user
 *   {username}     — their display name (no mention)
 *   {server}       — the guild's name
 *   {memberCount}  — current member count
 */
export const WelcomeConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  channelId: SnowflakeSchema.nullable(),
  joinTemplate: z.string().min(1).max(2000).nullable(),
  leaveTemplate: z.string().min(1).max(2000).nullable(),
  dmTemplate: z.string().min(1).max(2000).nullable(),
  autoRoleIds: z.array(SnowflakeSchema),
  milestoneEvery: z.number().int().min(1).max(100_000).nullable(),
  milestoneTemplate: z.string().min(1).max(2000).nullable(),
});

export type WelcomeConfig = z.infer<typeof WelcomeConfigSchema>;

export const UpdateWelcomeConfigSchema = WelcomeConfigSchema.omit({ guildId: true }).partial();

export type UpdateWelcomeConfigInput = z.infer<typeof UpdateWelcomeConfigSchema>;
