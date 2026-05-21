import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const TicketConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  panelChannelId: SnowflakeSchema.nullable(),
  panelMessageId: SnowflakeSchema.nullable(),
  staffRoleId: SnowflakeSchema.nullable(),
  defaultSlaSeconds: z.number().int().min(60).max(7 * 86_400).nullable(),
  transcriptChannelId: SnowflakeSchema.nullable(),
  slaReminderSeconds: z.number().int().min(60).max(7 * 86_400).nullable(),
  idleAutoCloseSeconds: z.number().int().min(300).max(30 * 86_400).nullable(),
  transcriptsEnabled: z.boolean(),
});

export type TicketConfig = z.infer<typeof TicketConfigSchema>;

export const UpdateTicketConfigSchema = TicketConfigSchema.omit({ guildId: true }).partial();
export type UpdateTicketConfigInput = z.infer<typeof UpdateTicketConfigSchema>;

export const TicketCategorySchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(300).nullable(),
  emoji: z.string().max(64).nullable(),
  staffRoleId: SnowflakeSchema.nullable(),
  slaSeconds: z.number().int().min(60).max(7 * 86_400).nullable(),
  position: z.number().int().nonnegative(),
});

export type TicketCategory = z.infer<typeof TicketCategorySchema>;

export const CreateTicketCategorySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  emoji: z.string().max(64).optional(),
  staffRoleId: SnowflakeSchema.optional(),
  slaSeconds: z.number().int().min(60).max(7 * 86_400).optional(),
  position: z.number().int().nonnegative().optional(),
});

export type CreateTicketCategoryInput = z.infer<typeof CreateTicketCategorySchema>;

export const TicketSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  categoryId: z.string().uuid().nullable(),
  userId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  number: z.number().int().positive(),
  status: z.enum(['open', 'closed']),
  subject: z.string().max(200).nullable(),
  assignedTo: SnowflakeSchema.nullable(),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  closedBy: SnowflakeSchema.nullable(),
  closeReason: z.string().max(500).nullable(),
  lastActivityAt: z.string().datetime().nullable(),
  slaReminderAt: z.string().datetime().nullable(),
});

export type Ticket = z.infer<typeof TicketSchema>;

export const CreateTicketSchema = z.object({
  userId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  categoryId: z.string().uuid().optional(),
  subject: z.string().max(200).optional(),
});

export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

export const UpdateTicketSchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  assignedTo: SnowflakeSchema.nullable().optional(),
  closedBy: SnowflakeSchema.nullable().optional(),
  closeReason: z.string().max(500).nullable().optional(),
  subject: z.string().max(200).nullable().optional(),
});

export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;
