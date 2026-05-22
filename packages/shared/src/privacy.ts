import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// ─── Data-export job ────────────────────────────────────────────────────

export const DataExportJobSchema = z.object({
  id: z.string().uuid(),
  userId: SnowflakeSchema,
  guildId: SnowflakeSchema.nullable(),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  fileUrl: z.string().max(2048).nullable(),
  status: z.enum(['pending', 'completed', 'failed']),
});
export type DataExportJob = z.infer<typeof DataExportJobSchema>;

export const RequestDataExportSchema = z.object({
  userId: SnowflakeSchema,
  guildId: SnowflakeSchema.optional(),
});
export type RequestDataExportInput = z.infer<typeof RequestDataExportSchema>;

// ─── Data-delete request ────────────────────────────────────────────────

export const DataDeleteRequestSchema = z.object({
  id: z.string().uuid(),
  userId: SnowflakeSchema,
  guildId: SnowflakeSchema.nullable(),
  requestedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  status: z.enum(['pending', 'confirmed', 'completed', 'failed']),
});
export type DataDeleteRequest = z.infer<typeof DataDeleteRequestSchema>;

export const RequestDataDeleteSchema = z.object({
  userId: SnowflakeSchema,
  guildId: SnowflakeSchema.optional(),
});
export type RequestDataDeleteInput = z.infer<typeof RequestDataDeleteSchema>;

// User DMs the token back via /data-delete-confirm; the API matches token,
// validates the same userId, then nukes the rows in a transaction.
export const ConfirmDeleteSchema = z.object({
  token: z.string().min(8).max(64),
  userId: SnowflakeSchema,
});
export type ConfirmDeleteInput = z.infer<typeof ConfirmDeleteSchema>;

// ─── Retention policy ───────────────────────────────────────────────────

export const RetentionPolicySchema = z.object({
  guildId: SnowflakeSchema,
  modActionsDays: z.number().int().min(1).max(3650).nullable(),
  modLogsDays: z.number().int().min(1).max(3650).nullable(),
  transcriptDays: z.number().int().min(1).max(3650).nullable(),
  snapshotDays: z.number().int().min(1).max(3650).nullable(),
  auditLogDays: z.number().int().min(1).max(3650).nullable(),
  redactPii: z.boolean(),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

// Partial-update body for PUT /guilds/:gid/retention-policy.
// `null` explicitly clears a horizon (no retention enforced for that table);
// missing keys leave the existing value untouched.
export const UpsertRetentionPolicySchema = z.object({
  modActionsDays: z.number().int().min(1).max(3650).nullable().optional(),
  modLogsDays: z.number().int().min(1).max(3650).nullable().optional(),
  transcriptDays: z.number().int().min(1).max(3650).nullable().optional(),
  snapshotDays: z.number().int().min(1).max(3650).nullable().optional(),
  auditLogDays: z.number().int().min(1).max(3650).nullable().optional(),
  redactPii: z.boolean().optional(),
});
export type UpsertRetentionPolicyInput = z.infer<typeof UpsertRetentionPolicySchema>;

// Discriminated identifier for the /retention set <table> <days> slash
// command. Mapped to RetentionPolicy column names by the API.
export const RetentionTableSchema = z.enum([
  'mod-actions',
  'mod-logs',
  'transcripts',
  'snapshots',
  'audit-log',
]);
export type RetentionTable = z.infer<typeof RetentionTableSchema>;
