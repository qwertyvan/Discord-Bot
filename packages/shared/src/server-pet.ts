import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Tamagotchi-style server pet. One row per guild. Stats are clamped 0..100
// at the API; the bot's pet-state util defines the decay curve and the
// XP→stage thresholds.

export const PetStageSchema = z.enum(['egg', 'baby', 'teen', 'adult', 'legendary']);
export type PetStage = z.infer<typeof PetStageSchema>;

export const PetInteractionKindSchema = z.enum(['feed', 'play', 'pet']);
export type PetInteractionKind = z.infer<typeof PetInteractionKindSchema>;

export const ServerPetSchema = z.object({
  guildId: SnowflakeSchema,
  name: z.string().min(1).max(48),
  stage: PetStageSchema,
  xp: z.number().int().nonnegative(),
  hunger: z.number().int().min(0).max(100),
  happiness: z.number().int().min(0).max(100),
  energy: z.number().int().min(0).max(100),
  lastUpdatedAt: z.string().datetime(),
});
export type ServerPet = z.infer<typeof ServerPetSchema>;

export const UpsertPetNameSchema = z.object({
  name: z.string().min(1).max(48),
});
export type UpsertPetNameInput = z.infer<typeof UpsertPetNameSchema>;

export const PetInteractionSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  kind: PetInteractionKindSchema,
  xpAwarded: z.number().int().nonnegative(),
  currencySpent: z.number().int().nonnegative(),
  at: z.string().datetime(),
});
export type PetInteraction = z.infer<typeof PetInteractionSchema>;

// Body the bot sends to the feed endpoint. `currencySpent` must be > 0 — the
// API debits it from the user's balance and uses the amount to scale the
// hunger/happiness/xp gains.
export const FeedRequestSchema = z.object({
  userId: SnowflakeSchema,
  currencySpent: z.number().int().positive(),
});
export type FeedRequestInput = z.infer<typeof FeedRequestSchema>;

export const PlayRequestSchema = z.object({
  userId: SnowflakeSchema,
});
export type PlayRequestInput = z.infer<typeof PlayRequestSchema>;

export const PetRequestSchema = z.object({
  userId: SnowflakeSchema,
});
export type PetRequestInput = z.infer<typeof PetRequestSchema>;

// Returned by feed/play/pet — gives the bot the new pet state plus the xp it
// just gained so it can render a delta in the embed.
export const PetActionResultSchema = z.object({
  pet: ServerPetSchema,
  xpAwarded: z.number().int().nonnegative(),
  newBalance: z.number().int().nonnegative().nullable(),
});
export type PetActionResult = z.infer<typeof PetActionResultSchema>;

export const TopFeederEntrySchema = z.object({
  userId: SnowflakeSchema,
  currencySpent: z.number().int().nonnegative(),
  interactions: z.number().int().nonnegative(),
});
export type TopFeederEntry = z.infer<typeof TopFeederEntrySchema>;

export const TopFeederResponseSchema = z.object({
  guildId: SnowflakeSchema,
  entries: z.array(TopFeederEntrySchema),
});
export type TopFeederResponse = z.infer<typeof TopFeederResponseSchema>;
