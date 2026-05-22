import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const ReportStatusSchema = z.enum(['open', 'reviewed']);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const ReportActionSchema = z.enum(['warn', 'mute', 'delete', 'dismiss']);
export type ReportAction = z.infer<typeof ReportActionSchema>;

export const ReportSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  reporterId: SnowflakeSchema,
  targetUserId: SnowflakeSchema,
  targetMessageId: SnowflakeSchema.nullable(),
  channelId: SnowflakeSchema,
  content: z.string().max(2000),
  status: ReportStatusSchema,
  reviewedBy: SnowflakeSchema.nullable(),
  reviewedAt: z.string().datetime().nullable(),
  actionTaken: ReportActionSchema.nullable(),
  reviewNote: z.string().max(500).nullable(),
  createdAt: z.string().datetime(),
});

export type Report = z.infer<typeof ReportSchema>;

export const CreateReportSchema = z.object({
  reporterId: SnowflakeSchema,
  targetUserId: SnowflakeSchema,
  targetMessageId: SnowflakeSchema.optional(),
  channelId: SnowflakeSchema,
  content: z.string().max(2000),
});

export type CreateReportInput = z.infer<typeof CreateReportSchema>;

export const ReviewReportSchema = z.object({
  action: ReportActionSchema,
  note: z.string().max(500).optional(),
});

export type ReviewReportInput = z.infer<typeof ReviewReportSchema>;

export const ReportListQuerySchema = z.object({
  status: ReportStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ReportListQuery = z.infer<typeof ReportListQuerySchema>;
