import type { GuildMember } from 'discord.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DIGIT_RATIO_THRESHOLD = 0.4;

export interface RiskScoreBreakdown {
  score: number;
  reasons: string[];
}

/**
 * Heuristic risk score in 0–100 for a joining member. Components are
 * intentionally coarse — the goal is to gate the captcha prompt, not to
 * adjudicate intent.
 *
 *   +30  account age < 7 days
 *   +20  Discord-default avatar (no custom upload)
 *   +20  spammy username (>= 40% digits)
 *   +30  recent join surge (caller-supplied — passed as `joinSurge`)
 */
export function computeRiskScore(
  member: GuildMember,
  opts: { joinSurge?: boolean } = {},
): RiskScoreBreakdown {
  let score = 0;
  const reasons: string[] = [];

  const createdAt = member.user.createdAt.getTime();
  if (Date.now() - createdAt < SEVEN_DAYS_MS) {
    score += 30;
    reasons.push('account < 7d old');
  }

  // discord.js: avatar=null means the user is on the default avatar.
  if (member.user.avatar === null) {
    score += 20;
    reasons.push('default avatar');
  }

  const username = member.user.username ?? '';
  if (username.length > 0) {
    const digits = (username.match(/\d/g) ?? []).length;
    if (digits / username.length >= DIGIT_RATIO_THRESHOLD) {
      score += 20;
      reasons.push('spammy username');
    }
  }

  if (opts.joinSurge) {
    score += 30;
    reasons.push('join surge');
  }

  return { score: Math.min(score, 100), reasons };
}
