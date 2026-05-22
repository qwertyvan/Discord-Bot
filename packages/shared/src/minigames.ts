import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// ─── Trivia ──────────────────────────────────────────────────────────

export const TriviaQuestionSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  prompt: z.string().min(1).max(500),
  choices: z.array(z.string().min(1).max(200)).min(2).max(6),
  correctIndex: z.number().int().min(0).max(5),
  category: z.string().min(1).max(64).nullable(),
  createdBy: SnowflakeSchema,
  createdAt: z.string().datetime(),
});

export type TriviaQuestion = z.infer<typeof TriviaQuestionSchema>;

export const CreateTriviaQuestionSchema = z
  .object({
    prompt: z.string().min(1).max(500),
    choices: z.array(z.string().min(1).max(200)).min(2).max(6),
    correctIndex: z.number().int().min(0).max(5),
    category: z.string().min(1).max(64).optional(),
    createdBy: SnowflakeSchema,
  })
  .refine((v) => v.correctIndex < v.choices.length, {
    message: 'correctIndex must be within choices range',
    path: ['correctIndex'],
  });

export type CreateTriviaQuestionInput = z.infer<typeof CreateTriviaQuestionSchema>;

export const TriviaScoreSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export type TriviaScore = z.infer<typeof TriviaScoreSchema>;

export const IncrementTriviaScoreSchema = z.object({
  userId: SnowflakeSchema,
  correct: z.boolean(),
});

export type IncrementTriviaScoreInput = z.infer<typeof IncrementTriviaScoreSchema>;

// ─── Hangman ─────────────────────────────────────────────────────────

export const HangmanStatusSchema = z.enum(['active', 'won', 'lost', 'abandoned']);
export type HangmanStatus = z.infer<typeof HangmanStatusSchema>;

export const HangmanGameSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  hostId: SnowflakeSchema,
  word: z.string().min(1).max(64),
  revealed: z.string().min(1).max(64),
  misses: z.string().max(32),
  maxMisses: z.number().int().min(1).max(20),
  messageId: SnowflakeSchema.nullable(),
  status: HangmanStatusSchema,
  createdAt: z.string().datetime(),
});

export type HangmanGame = z.infer<typeof HangmanGameSchema>;

export const CreateHangmanGameSchema = z.object({
  channelId: SnowflakeSchema,
  hostId: SnowflakeSchema,
  word: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z ]+$/, 'word must contain only letters and spaces'),
  maxMisses: z.number().int().min(1).max(20).optional(),
});

export type CreateHangmanGameInput = z.infer<typeof CreateHangmanGameSchema>;

export const UpdateHangmanGameSchema = z.object({
  revealed: z.string().min(1).max(64).optional(),
  misses: z.string().max(32).optional(),
  status: HangmanStatusSchema.optional(),
  messageId: SnowflakeSchema.nullable().optional(),
});

export type UpdateHangmanGameInput = z.infer<typeof UpdateHangmanGameSchema>;

// ─── RPS ─────────────────────────────────────────────────────────────

export const RpsChoiceSchema = z.enum(['rock', 'paper', 'scissors']);
export type RpsChoice = z.infer<typeof RpsChoiceSchema>;

export const RpsChallengeStatusSchema = z.enum(['open', 'resolved', 'cancelled']);
export type RpsChallengeStatus = z.infer<typeof RpsChallengeStatusSchema>;

export const RpsRecordSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  elo: z.number().int().nonnegative(),
});

export type RpsRecord = z.infer<typeof RpsRecordSchema>;

export const RpsChallengeSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  challengerId: SnowflakeSchema,
  opponentId: SnowflakeSchema,
  challengerChoice: RpsChoiceSchema.nullable(),
  opponentChoice: RpsChoiceSchema.nullable(),
  status: RpsChallengeStatusSchema,
  createdAt: z.string().datetime(),
});

export type RpsChallenge = z.infer<typeof RpsChallengeSchema>;

export const CreateRpsChallengeSchema = z.object({
  channelId: SnowflakeSchema,
  challengerId: SnowflakeSchema,
  opponentId: SnowflakeSchema,
  challengerChoice: RpsChoiceSchema,
});

export type CreateRpsChallengeInput = z.infer<typeof CreateRpsChallengeSchema>;

export const RespondRpsChallengeSchema = z.object({
  opponentId: SnowflakeSchema,
  opponentChoice: RpsChoiceSchema,
});

export type RespondRpsChallengeInput = z.infer<typeof RespondRpsChallengeSchema>;

export const RpsResultSchema = z.enum(['challenger', 'opponent', 'draw']);
export type RpsResult = z.infer<typeof RpsResultSchema>;

export const ResolveRpsChallengeResultSchema = z.object({
  challenge: RpsChallengeSchema,
  result: RpsResultSchema,
  challengerRecord: RpsRecordSchema,
  opponentRecord: RpsRecordSchema,
  challengerEloDelta: z.number().int(),
  opponentEloDelta: z.number().int(),
});

export type ResolveRpsChallengeResult = z.infer<typeof ResolveRpsChallengeResultSchema>;

// ─── Daily streak ────────────────────────────────────────────────────

export const DailyStreakSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  streak: z.number().int().nonnegative(),
  lastClaimAt: z.string().datetime().nullable(),
});

export type DailyStreak = z.infer<typeof DailyStreakSchema>;

export const ClaimDailyResultSchema = z.object({
  streak: DailyStreakSchema,
  rewardCurrency: z.number().int().nonnegative(),
  alreadyClaimed: z.boolean(),
});

export type ClaimDailyResult = z.infer<typeof ClaimDailyResultSchema>;
