import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const AutomodActionSchema = z.enum(['DELETE', 'WARN', 'TIMEOUT', 'KICK', 'BAN', 'NONE']);
export type AutomodAction = z.infer<typeof AutomodActionSchema>;

const BaseRule = z.object({
  enabled: z.boolean().default(false),
  action: AutomodActionSchema.default('DELETE'),
  // Optional follow-up duration when action is TIMEOUT (ms).
  durationMs: z.number().int().positive().optional(),
});

export const AntispamRuleSchema = BaseRule.extend({
  // Trigger when a user posts ≥ threshold messages within `windowSeconds`.
  windowSeconds: z.number().int().min(2).max(120).default(5),
  threshold: z.number().int().min(2).max(50).default(5),
});

export const AntiinviteRuleSchema = BaseRule.extend({
  // Guilds whose invites are allowed (e.g. the home guild).
  allowedGuildIds: z.array(SnowflakeSchema).default([]),
});

export const LinksRuleSchema = BaseRule.extend({
  mode: z.enum(['allow', 'block']).default('block'),
  domains: z.array(z.string().min(1).max(253)).default([]),
});

export const PhishingRuleSchema = BaseRule.extend({
  // Static domains to always block. The bot may also consult an external
  // list (e.g. anti-fish.bitflow.dev) on a periodic refresh — left to the
  // bot implementation.
  staticDomains: z.array(z.string()).default([]),
});

export const BadwordsRuleSchema = BaseRule.extend({
  words: z.array(z.string().min(1).max(64)).default([]),
  // If true, "ass" matches "assassin". If false, only whole-word matches.
  matchSubstring: z.boolean().default(false),
});

export const MassMentionRuleSchema = BaseRule.extend({
  // Number of distinct user/role mentions that triggers the rule.
  threshold: z.number().int().min(3).max(50).default(5),
});

export const CapsRuleSchema = BaseRule.extend({
  // Only messages of at least this many letters are checked.
  minLength: z.number().int().min(5).max(500).default(10),
  // Fraction of A-Z letters that must be uppercase to trip (0-1).
  threshold: z.number().min(0.5).max(1).default(0.7),
});

export const EmojiSpamRuleSchema = BaseRule.extend({
  // Number of emoji that triggers the rule.
  threshold: z.number().int().min(3).max(50).default(8),
});

export const ZalgoRuleSchema = BaseRule.extend({
  // Maximum allowed ratio of combining-mark characters to total length.
  threshold: z.number().min(0.05).max(1).default(0.3),
});

export const NewAccountRuleSchema = BaseRule.extend({
  // Accounts younger than this many days at join trigger the rule.
  ageDays: z.number().int().min(1).max(365).default(7),
});

export const RaidRuleSchema = BaseRule.extend({
  // joinThreshold joins within windowSeconds → server-wide lockdown.
  windowSeconds: z.number().int().min(5).max(600).default(30),
  joinThreshold: z.number().int().min(3).max(50).default(10),
});

export const NsfwImageRuleSchema = BaseRule.extend({
  // Placeholder — requires an external classifier; bots may no-op when unconfigured.
  enabled: z.boolean().default(false),
});

export const SafeBrowsingRuleSchema = BaseRule.extend({
  // Placeholder — requires Google Safe Browsing API key; no-op when unconfigured.
  enabled: z.boolean().default(false),
});

export const AutomodRulesSchema = z.object({
  antispam: AntispamRuleSchema.optional(),
  antiinvite: AntiinviteRuleSchema.optional(),
  links: LinksRuleSchema.optional(),
  phishing: PhishingRuleSchema.optional(),
  badwords: BadwordsRuleSchema.optional(),
  massmention: MassMentionRuleSchema.optional(),
  caps: CapsRuleSchema.optional(),
  emojispam: EmojiSpamRuleSchema.optional(),
  zalgo: ZalgoRuleSchema.optional(),
  newaccount: NewAccountRuleSchema.optional(),
  raid: RaidRuleSchema.optional(),
  nsfwImage: NsfwImageRuleSchema.optional(),
  safeBrowsing: SafeBrowsingRuleSchema.optional(),
});

export type AutomodRules = z.infer<typeof AutomodRulesSchema>;
export const AUTOMOD_RULE_KEYS = Object.keys(AutomodRulesSchema.shape) as (keyof AutomodRules)[];

export const AutomodConfigSchema = z.object({
  guildId: SnowflakeSchema,
  enabled: z.boolean(),
  exemptRoleIds: z.array(SnowflakeSchema),
  exemptChannelIds: z.array(SnowflakeSchema),
  rules: AutomodRulesSchema,
});

export type AutomodConfig = z.infer<typeof AutomodConfigSchema>;

export const UpdateAutomodConfigSchema = z.object({
  enabled: z.boolean().optional(),
  exemptRoleIds: z.array(SnowflakeSchema).optional(),
  exemptChannelIds: z.array(SnowflakeSchema).optional(),
  rules: AutomodRulesSchema.optional(),
});

export type UpdateAutomodConfigInput = z.infer<typeof UpdateAutomodConfigSchema>;

export const AutomodHitSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  userId: SnowflakeSchema,
  channelId: SnowflakeSchema.nullable(),
  rule: z.string(),
  action: z.string(),
  reason: z.string(),
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});

export type AutomodHit = z.infer<typeof AutomodHitSchema>;

export const CreateAutomodHitSchema = z.object({
  userId: SnowflakeSchema,
  channelId: SnowflakeSchema.optional(),
  rule: z.string().min(1).max(64),
  action: z.string().min(1).max(32),
  reason: z.string().min(1).max(500),
  payload: z.record(z.unknown()).optional(),
});

export type CreateAutomodHitInput = z.infer<typeof CreateAutomodHitSchema>;
