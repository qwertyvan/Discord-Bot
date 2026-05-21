import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const IntegrationKindSchema = z.enum(['rss', 'webhook']);
export type IntegrationKind = z.infer<typeof IntegrationKindSchema>;

export const IntegrationSubscriptionSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  name: z.string().min(1).max(80),
  kind: IntegrationKindSchema,
  rssUrl: z.string().url().nullable(),
  lastSeenGuid: z.string().nullable(),
  lastPolledAt: z.string().datetime().nullable(),
  pollInterval: z.number().int().min(60).max(86_400),
  token: z.string().nullable(),
  secret: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
});

export type IntegrationSubscription = z.infer<typeof IntegrationSubscriptionSchema>;

export const CreateIntegrationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rss'),
    name: z.string().min(1).max(80),
    channelId: SnowflakeSchema,
    rssUrl: z.string().url(),
    pollInterval: z.number().int().min(60).max(86_400).optional(),
  }),
  z.object({
    kind: z.literal('webhook'),
    name: z.string().min(1).max(80),
    channelId: SnowflakeSchema,
    secret: z.string().min(8).max(128).optional(),
  }),
]);

export type CreateIntegrationInput = z.infer<typeof CreateIntegrationSchema>;

export const UpdateIntegrationSchema = z.object({
  channelId: SnowflakeSchema.optional(),
  name: z.string().min(1).max(80).optional(),
  rssUrl: z.string().url().nullable().optional(),
  pollInterval: z.number().int().min(60).max(86_400).optional(),
  enabled: z.boolean().optional(),
  secret: z.string().min(8).max(128).nullable().optional(),
});

export type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationSchema>;
