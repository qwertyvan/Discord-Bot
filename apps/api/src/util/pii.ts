import { createHash } from 'node:crypto';

// Return an opaque 12-char hash of (userId + guildId) so the dashboard can
// still group events by "the same user" without revealing the underlying
// Discord snowflake. The salt is the guildId itself: it's stable per guild,
// and a different guild yields a different bucket for the same user, which
// matches the policy boundary.
//
// When the policy says don't redact (or the user id is null), the original
// value is returned unchanged.
export function getRedactedUserId(
  userId: string | null,
  guildId: string,
  policy: { redactPii: boolean } | null,
): string | null {
  if (!userId) return null;
  if (!policy?.redactPii) return userId;
  return createHash('sha256').update(`${userId}:${guildId}`).digest('hex').slice(0, 12);
}
