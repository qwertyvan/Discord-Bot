import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const CaptchaKindSchema = z.enum(['math', 'image']);
export type CaptchaKind = z.infer<typeof CaptchaKindSchema>;

export const AntiRaidConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  joinsPerMinuteThreshold: z.number().int().min(1).max(1000),
  lockdownDurationMin: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  captchaRequired: z.boolean(),
  captchaKind: CaptchaKindSchema,
  riskScoreThreshold: z.number().int().min(0).max(100),
  unverifiedRoleId: SnowflakeSchema.nullable(),
});

export type AntiRaidConfig = z.infer<typeof AntiRaidConfigSchema>;

export const UpsertAntiRaidConfigSchema = AntiRaidConfigSchema.omit({ guildId: true }).partial();

export type UpsertAntiRaidConfigInput = z.infer<typeof UpsertAntiRaidConfigSchema>;

export const LockdownEventSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  trigger: z.string().max(64),
  joinsBlocked: z.number().int().nonnegative(),
});

export type LockdownEvent = z.infer<typeof LockdownEventSchema>;

export const StartLockdownSchema = z.object({
  trigger: z.string().min(1).max(64),
});
export type StartLockdownInput = z.infer<typeof StartLockdownSchema>;

export const PendingVerificationSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  challengeKind: CaptchaKindSchema,
  challenge: z.string().min(1).max(200),
  // Stored answer is normalised to lowercase before write; matched
  // case-insensitively on /verify.
  answer: z.string().min(1).max(64),
  attemptsLeft: z.number().int().min(0).max(10),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type PendingVerification = z.infer<typeof PendingVerificationSchema>;

export const CreatePendingVerificationSchema = z.object({
  userId: SnowflakeSchema,
  challengeKind: CaptchaKindSchema,
  challenge: z.string().min(1).max(200),
  answer: z.string().min(1).max(64),
  expiresAt: z.string().datetime(),
  attemptsLeft: z.number().int().min(1).max(10).optional(),
});
export type CreatePendingVerificationInput = z.infer<typeof CreatePendingVerificationSchema>;

export const VerifyChallengeSchema = z.object({
  answer: z.string().min(1).max(64),
});
export type VerifyChallengeInput = z.infer<typeof VerifyChallengeSchema>;

export const VerifyChallengeResultSchema = z.object({
  ok: z.boolean(),
  attemptsLeft: z.number().int().nonnegative(),
  expired: z.boolean(),
  notFound: z.boolean(),
});
export type VerifyChallengeResult = z.infer<typeof VerifyChallengeResultSchema>;
