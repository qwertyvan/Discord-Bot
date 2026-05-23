import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// ─── Battle pet ──────────────────────────────────────────────────────

export const BattlePetSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  name: z.string().min(1).max(48),
  species: z.string().min(1).max(32),
  level: z.number().int().min(1),
  xp: z.number().int().nonnegative(),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  atk: z.number().int().nonnegative(),
  def: z.number().int().nonnegative(),
  spd: z.number().int().nonnegative(),
  allocPoints: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  elo: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export type BattlePet = z.infer<typeof BattlePetSchema>;

// PATCH body: rename only.
export const UpsertBattlePetNameSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[\w\- '!?.]+$/, 'name contains invalid characters'),
});

export type UpsertBattlePetNameInput = z.infer<typeof UpsertBattlePetNameSchema>;

// PATCH body: spend allocation points across stats. Each amount must be
// non-negative; the API enforces that the sum doesn't exceed `allocPoints`.
export const AllocateStatsSchema = z
  .object({
    atk: z.number().int().nonnegative().default(0),
    def: z.number().int().nonnegative().default(0),
    spd: z.number().int().nonnegative().default(0),
    maxHp: z.number().int().nonnegative().default(0),
  })
  .refine(
    (v) => v.atk + v.def + v.spd + v.maxHp > 0,
    { message: 'allocate at least one point' },
  );

export type AllocateStatsInput = z.infer<typeof AllocateStatsSchema>;

// ─── Duel match ──────────────────────────────────────────────────────

export const DuelStatusSchema = z.enum(['pending', 'active', 'ended', 'cancelled']);
export type DuelStatus = z.infer<typeof DuelStatusSchema>;

export const DuelMoveSchema = z.enum(['attack', 'defend', 'special']);
export type DuelMove = z.infer<typeof DuelMoveSchema>;

// One entry in the play-by-play log. `damage` may be 0 (defend, missed
// special); `crit` is true when the actor's speed-modulated crit roll fired.
export const DuelLogEntrySchema = z.object({
  turn: z.number().int().nonnegative(),
  actorId: SnowflakeSchema,
  move: DuelMoveSchema,
  damage: z.number().int().nonnegative(),
  crit: z.boolean().optional(),
  challengerHp: z.number().int(),
  opponentHp: z.number().int(),
  note: z.string().max(120).optional(),
});

export type DuelLogEntry = z.infer<typeof DuelLogEntrySchema>;

export const DuelMatchSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  challengerId: SnowflakeSchema,
  opponentId: SnowflakeSchema,
  status: DuelStatusSchema,
  turn: z.number().int().nonnegative(),
  currentActorId: SnowflakeSchema.nullable(),
  log: z.array(DuelLogEntrySchema),
  winnerId: SnowflakeSchema.nullable(),
  // Live per-side HP snapshot, computed from `log` on serialize so callers
  // don't have to replay the log themselves.
  challengerHp: z.number().int(),
  opponentHp: z.number().int(),
  // Per-side defend flag for the next incoming hit. Mirrors server state.
  challengerDefending: z.boolean(),
  opponentDefending: z.boolean(),
  createdAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});

export type DuelMatch = z.infer<typeof DuelMatchSchema>;

export const CreateDuelSchema = z.object({
  challengerId: SnowflakeSchema,
  opponentId: SnowflakeSchema,
});

export type CreateDuelInput = z.infer<typeof CreateDuelSchema>;

export const RespondDuelSchema = z.object({
  userId: SnowflakeSchema,
  action: z.enum(['accept', 'decline']),
});

export type RespondDuelInput = z.infer<typeof RespondDuelSchema>;

export const SubmitDuelMoveSchema = z.object({
  userId: SnowflakeSchema,
  move: DuelMoveSchema,
});

export type SubmitDuelMoveInput = z.infer<typeof SubmitDuelMoveSchema>;

export const DuelMoveResultSchema = z.object({
  match: DuelMatchSchema,
  // Most-recent log entry (echoed for convenience).
  lastEntry: DuelLogEntrySchema,
  ended: z.boolean(),
  // Populated only when `ended` is true.
  winnerId: SnowflakeSchema.nullable(),
  loserId: SnowflakeSchema.nullable(),
  challengerEloDelta: z.number().int(),
  opponentEloDelta: z.number().int(),
  // Currency awarded to the winner (0 if economy not enabled).
  rewardCurrency: z.number().int().nonnegative(),
});

export type DuelMoveResult = z.infer<typeof DuelMoveResultSchema>;

export const BattleLeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  name: z.string(),
  species: z.string(),
  level: z.number().int().nonnegative(),
  elo: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
});

export type BattleLeaderboardEntry = z.infer<typeof BattleLeaderboardEntrySchema>;
