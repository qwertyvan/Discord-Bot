import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

/**
 * The shape of a config-snapshot payload: a map from Prisma model name to the
 * array of rows for that model belonging to a single guild. Row contents are
 * intentionally opaque to the schema — restore round-trips them verbatim back
 * through Prisma `createMany` calls, so any type drift is caught at restore
 * time rather than schema-validation time.
 */
export const SnapshotPayloadSchema = z.record(z.string(), z.array(z.unknown()));
export type SnapshotPayload = z.infer<typeof SnapshotPayloadSchema>;

/**
 * Metadata-only view of a config snapshot. List endpoints return this shape
 * (no `payload`) so the dashboard isn't pulling megabytes per page; the full
 * payload is fetched only via the per-snapshot detail endpoint.
 */
export const ConfigSnapshotSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  createdAt: z.string().datetime(),
  label: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative(),
  createdBy: SnowflakeSchema.nullable(),
});

export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

/**
 * Detail shape: metadata + payload. Returned by GET /snapshots/:id and used
 * by the dashboard download button.
 */
export const ConfigSnapshotDetailSchema = ConfigSnapshotSchema.extend({
  payload: SnapshotPayloadSchema,
});

export type ConfigSnapshotDetail = z.infer<typeof ConfigSnapshotDetailSchema>;

export const CreateSnapshotSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  createdBy: SnowflakeSchema.optional(),
});

export type CreateSnapshotInput = z.infer<typeof CreateSnapshotSchema>;

export const SnapshotPolicySchema = z.object({
  guildId: SnowflakeSchema,
  autoEnabled: z.boolean(),
  retentionDays: z.number().int().min(1).max(365),
  updatedAt: z.string().datetime(),
});

export type SnapshotPolicy = z.infer<typeof SnapshotPolicySchema>;

export const UpsertSnapshotPolicySchema = z.object({
  autoEnabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
});

export type UpsertSnapshotPolicyInput = z.infer<typeof UpsertSnapshotPolicySchema>;
