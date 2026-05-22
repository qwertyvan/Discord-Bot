import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Captured shape of a Discord guild's structural topology. The bot fills
// this in via util/template-capture.ts; the API stores it verbatim as the
// template payload. Channel categories are represented as ordinary channels
// of type 4 (GuildCategory) with parentName=null; non-category channels
// reference the category by name via parentName.
export const TemplateRoleSchema = z.object({
  name: z.string().min(1).max(100),
  // Discord roles store the color as an int (0xRRGGBB). Use number for
  // round-trip safety.
  color: z.number().int().min(0).max(0xffffff),
  hoist: z.boolean(),
  mentionable: z.boolean(),
  // Permissions are a 64-bit bitfield; serialise as a decimal string.
  permissions: z.string().regex(/^\d+$/, 'Must be a decimal bitfield string.'),
});

export type TemplateRole = z.infer<typeof TemplateRoleSchema>;

export const TemplateOverwriteSchema = z.object({
  // null = @everyone (the role with the same id as the guild). For named
  // role overwrites we resolve by role name on apply.
  roleName: z.string().min(1).max(100).optional(),
  // Decimal bitfield strings.
  allow: z.string().regex(/^\d+$/, 'Must be a decimal bitfield string.'),
  deny: z.string().regex(/^\d+$/, 'Must be a decimal bitfield string.'),
});

export type TemplateOverwrite = z.infer<typeof TemplateOverwriteSchema>;

export const TemplateChannelSchema = z.object({
  name: z.string().min(1).max(100),
  // Discord ChannelType: 0 text, 2 voice, 4 category, 5 announcement, 13 stage, 15 forum.
  type: z.number().int().min(0).max(15),
  position: z.number().int().min(0).max(10_000),
  parentName: z.string().min(1).max(100).optional(),
  topic: z.string().max(1024).optional(),
  nsfw: z.boolean().optional(),
  slowmode: z.number().int().min(0).max(21_600).optional(),
  overwrites: z.array(TemplateOverwriteSchema),
});

export type TemplateChannel = z.infer<typeof TemplateChannelSchema>;

export const TemplatePayloadSchema = z.object({
  roles: z.array(TemplateRoleSchema).max(250),
  channels: z.array(TemplateChannelSchema).max(500),
});

export type TemplatePayload = z.infer<typeof TemplatePayloadSchema>;

export const ServerTemplateSchema = z.object({
  id: z.string().uuid(),
  ownerGuildId: SnowflakeSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  payload: TemplatePayloadSchema,
  version: z.number().int().min(1),
  public: z.boolean(),
  createdBy: SnowflakeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ServerTemplate = z.infer<typeof ServerTemplateSchema>;

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  createdBy: SnowflakeSchema,
  payload: TemplatePayloadSchema,
});

export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;

// For /diff the bot supplies the current guild's captured payload so the
// API can compute the structural delta server-side without needing live
// Discord access.
export const ApplyTemplateSchema = z.object({
  onConflict: z.enum(['skip', 'rename']).default('skip'),
});

export type ApplyTemplateInput = z.infer<typeof ApplyTemplateSchema>;

const DiffChangeSchema = z.object({
  name: z.string(),
  // Freeform reason describing what differs (e.g. "color", "permissions").
  reason: z.string(),
});

export const TemplateDiffSchema = z.object({
  roles: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changed: z.array(DiffChangeSchema),
  }),
  channels: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changed: z.array(DiffChangeSchema),
  }),
});

export type TemplateDiff = z.infer<typeof TemplateDiffSchema>;

export interface TemplateApplyReport {
  rolesCreated: string[];
  rolesSkipped: string[];
  channelsCreated: string[];
  channelsSkipped: string[];
  errors: Array<{ kind: 'role' | 'channel'; name: string; message: string }>;
}
