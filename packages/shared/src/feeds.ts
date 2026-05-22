import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

export const FeedKindSchema = z.enum(['youtube', 'reddit', 'bluesky', 'mastodon']);
export type FeedKind = z.infer<typeof FeedKindSchema>;

export const FeedSubscriptionSchema = z.object({
  id: z.string().uuid(),
  guildId: SnowflakeSchema,
  kind: FeedKindSchema,
  identifier: z.string().min(1).max(200),
  channelId: SnowflakeSchema,
  template: z.string().min(1).max(500).nullable(),
  lastItemId: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
});

export type FeedSubscription = z.infer<typeof FeedSubscriptionSchema>;

// Per-kind identifier validators. We enforce shape lightly here; the
// underlying provider is the source of truth and will reject anything
// genuinely malformed at poll time.
const YoutubeChannelId = z
  .string()
  .regex(/^UC[A-Za-z0-9_-]{20,30}$/i, 'YouTube channel id must look like UCxxxx (24 chars).');
const SubredditName = z
  .string()
  .min(2)
  .max(21)
  .regex(/^[A-Za-z0-9_]+$/, 'Subreddit names are alphanumeric/underscore.');
const BlueskyHandle = z
  .string()
  .min(3)
  .max(253)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i,
    'Bluesky handles look like alice.bsky.social.',
  );
const MastodonAddress = z
  .string()
  .min(4)
  .max(200)
  .regex(/^@?[a-z0-9_.-]+@[a-z0-9.-]+\.[a-z]{2,}$/i, 'Use @user@instance.tld for Mastodon.');

export const CreateFeedSubscriptionSchema = z
  .object({
    kind: FeedKindSchema,
    identifier: z.string().min(1).max(200),
    channelId: SnowflakeSchema,
    template: z.string().min(1).max(500).optional(),
  })
  .superRefine((val, ctx) => {
    const result =
      val.kind === 'youtube'
        ? YoutubeChannelId.safeParse(val.identifier)
        : val.kind === 'reddit'
          ? SubredditName.safeParse(val.identifier)
          : val.kind === 'bluesky'
            ? BlueskyHandle.safeParse(val.identifier)
            : MastodonAddress.safeParse(val.identifier);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identifier'], message: issue.message });
      }
    }
  });

export type CreateFeedSubscriptionInput = z.infer<typeof CreateFeedSubscriptionSchema>;

export const UpdateFeedLastItemSchema = z.object({
  lastItemId: z.string().nullable(),
});

export type UpdateFeedLastItemInput = z.infer<typeof UpdateFeedLastItemSchema>;
