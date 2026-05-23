import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

// Hex color in #RRGGBB form. We reject 3-digit shorthand to keep the wire
// format unambiguous when round-tripping through Discord embeds.
export const AccentColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/u, 'Accent color must be #RRGGBB.');

export const ProfileBadgeSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  slug: z.string().min(1).max(48),
  name: z.string().min(1).max(64),
  emoji: z.string().min(1).max(64),
  description: z.string().max(200).nullable(),
  createdAt: z.string().datetime(),
});

export type ProfileBadge = z.infer<typeof ProfileBadgeSchema>;

export const CreateProfileBadgeSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-_]*$/u, 'Slug must be lowercase alphanumeric (hyphens/underscores ok).'),
  name: z.string().min(1).max(64),
  emoji: z.string().min(1).max(64),
  description: z.string().max(200).optional(),
});

export type CreateProfileBadgeInput = z.infer<typeof CreateProfileBadgeSchema>;

export const UserBadgeSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  badgeId: z.string().uuid(),
  awardedAt: z.string().datetime(),
  awardedBy: SnowflakeSchema.nullable(),
  badge: ProfileBadgeSchema,
});

export type UserBadge = z.infer<typeof UserBadgeSchema>;

export const UserProfileSchema = z.object({
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  bio: z.string().max(400).nullable(),
  accentColor: AccentColorSchema.nullable(),
  favoriteQuote: z.string().max(200).nullable(),
  updatedAt: z.string().datetime(),
  badges: z.array(UserBadgeSchema),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// Upsert payload — every field optional so callers can patch one at a time.
// `null` clears the field; `undefined` leaves it unchanged.
export const UpsertUserProfileSchema = z.object({
  bio: z.string().max(400).nullable().optional(),
  accentColor: AccentColorSchema.nullable().optional(),
  favoriteQuote: z.string().max(200).nullable().optional(),
});

export type UpsertUserProfileInput = z.infer<typeof UpsertUserProfileSchema>;

export const GrantUserBadgeSchema = z.object({
  userId: SnowflakeSchema,
  awardedBy: SnowflakeSchema.optional(),
});

export type GrantUserBadgeInput = z.infer<typeof GrantUserBadgeSchema>;
