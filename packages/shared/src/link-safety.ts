import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const LinkSafetyModeSchema = z.enum(['allowlist', 'blocklist']);
export type LinkSafetyMode = z.infer<typeof LinkSafetyModeSchema>;

export const LinkSafetyActionSchema = z.enum(['none', 'delete', 'warn', 'mute', 'kick']);
export type LinkSafetyAction = z.infer<typeof LinkSafetyActionSchema>;

export const LinkDomainKindSchema = z.enum(['allow', 'block']);
export type LinkDomainKind = z.infer<typeof LinkDomainKindSchema>;

// A normalised domain: lowercase, no scheme, no path. Up to 255 chars (DNS limit).
export const DomainSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Must look like a domain (e.g. example.com).');

export const LinkSafetyConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  mode: LinkSafetyModeSchema,
  action: LinkSafetyActionSchema,
  muteMinutes: z.number().int().min(1).max(40320),
  notifyChannelId: SnowflakeSchema.nullable(),
  expandShorteners: z.boolean(),
  gsbCheck: z.boolean(),
});

export type LinkSafetyConfig = z.infer<typeof LinkSafetyConfigSchema>;

export const UpsertLinkSafetyConfigSchema = LinkSafetyConfigSchema.omit({ guildId: true })
  .partial();

export type UpsertLinkSafetyConfigInput = z.infer<typeof UpsertLinkSafetyConfigSchema>;

export const LinkDomainSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  domain: DomainSchema,
  kind: LinkDomainKindSchema,
  addedBy: SnowflakeSchema,
  addedAt: z.string().datetime(),
});

export type LinkDomain = z.infer<typeof LinkDomainSchema>;

export const CreateLinkDomainSchema = z.object({
  domain: DomainSchema,
  kind: LinkDomainKindSchema,
  addedBy: SnowflakeSchema,
});

export type CreateLinkDomainInput = z.infer<typeof CreateLinkDomainSchema>;
