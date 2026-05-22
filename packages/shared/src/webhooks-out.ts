import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Allowed event names — outbound webhook subscribers select from these. Kept
// intentionally narrow; extending the set requires both this enum and a
// dispatchEvent() call somewhere on the API side.
export const OutboundEventTypeSchema = z.enum([
  'modaction.created',
  'ticket.opened',
  'ticket.closed',
  'suggestion.created',
  'suggestion.reviewed',
  'member.join',
  'member.leave',
  'webhook.test',
]);

export type OutboundEventType = z.infer<typeof OutboundEventTypeSchema>;

// Serialized webhook row — the secret is *never* returned after creation.
export const OutboundWebhookSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  url: z.string().url().max(2048),
  events: z.array(OutboundEventTypeSchema),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  lastDeliveryAt: z.string().datetime().nullable(),
  lastStatus: z.number().int().nullable(),
});

export type OutboundWebhook = z.infer<typeof OutboundWebhookSchema>;

export const CreateOutboundWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(OutboundEventTypeSchema).min(1),
  // Optional: caller-supplied HMAC secret. If omitted the server generates one
  // and returns it once via `secret` on the response.
  secret: z.string().min(16).max(256).optional(),
  active: z.boolean().optional(),
});

export type CreateOutboundWebhookInput = z.infer<typeof CreateOutboundWebhookSchema>;

export const UpdateOutboundWebhookSchema = z.object({
  url: z.string().url().max(2048).optional(),
  events: z.array(OutboundEventTypeSchema).min(1).optional(),
  active: z.boolean().optional(),
});

export type UpdateOutboundWebhookInput = z.infer<typeof UpdateOutboundWebhookSchema>;

export const WebhookDeliverySchema = z.object({
  id: z.string().uuid(),
  webhookId: z.string().uuid(),
  eventType: z.string(),
  payload: z.record(z.unknown()),
  status: z.number().int(),
  attemptCount: z.number().int().nonnegative(),
  deliveredAt: z.string().datetime().nullable(),
  nextRetryAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

// Available scopes for public API tokens. Add new ones here as routes get
// added under /public/*.
export const PublicApiScopeSchema = z.enum(['stats:read']);
export type PublicApiScope = z.infer<typeof PublicApiScopeSchema>;

export const PublicApiTokenSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  name: z.string().min(1).max(64),
  scopes: z.array(PublicApiScopeSchema),
  createdBy: SnowflakeSchema,
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});

export type PublicApiToken = z.infer<typeof PublicApiTokenSchema>;

export const CreatePublicApiTokenSchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(PublicApiScopeSchema).min(1),
  createdBy: SnowflakeSchema,
});

export type CreatePublicApiTokenInput = z.infer<typeof CreatePublicApiTokenSchema>;

// Response for "create token" — the *only* time the plaintext token is
// returned. Callers must store it client-side; the API only persists a hash.
export const PublicApiTokenSecretSchema = PublicApiTokenSchema.extend({
  token: z.string(),
});

export type PublicApiTokenSecret = z.infer<typeof PublicApiTokenSecretSchema>;
