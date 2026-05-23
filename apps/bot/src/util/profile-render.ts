import { EmbedBuilder, time, TimestampStyles, type GuildMember, type User } from 'discord.js';
import type { UserBadge, UserProfile } from '@discord-bot/shared';

/**
 * Build the rich /profile embed. `member` is required for the avatar +
 * display color fallback; `profile.bio`/`accentColor`/`favoriteQuote` are
 * optional and skipped when null. Badges (up to 5) render as an inline
 * field of emoji + name pairs.
 *
 * `levelInfo` and `balance` are best-effort and rendered only when the
 * caller has them; both come from existing /level + /balance endpoints
 * and can be omitted if those subsystems are disabled.
 */
export interface ProfileLevelInfo {
  level: number;
  xp: number;
  rank: number | null;
}

export interface BuildProfileEmbedOptions {
  member: GuildMember | null;
  user: User;
  profile: UserProfile;
  badges: UserBadge[];
  levelInfo?: ProfileLevelInfo | null;
  balance?: number | null;
}

const DEFAULT_COLOR = 0x5865f2;

function parseHex(hex: string | null): number | null {
  if (!hex) return null;
  const m = /^#([0-9a-fA-F]{6})$/u.exec(hex);
  if (!m || !m[1]) return null;
  return Number.parseInt(m[1], 16);
}

export function buildProfileEmbed(opts: BuildProfileEmbedOptions): EmbedBuilder {
  const { member, user, profile, badges, levelInfo, balance } = opts;

  // Accent precedence: user-chosen accent → member role color → fallback.
  const accent = parseHex(profile.accentColor) ?? member?.displayColor ?? DEFAULT_COLOR;

  const embed = new EmbedBuilder()
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setColor(accent);

  if (profile.bio) {
    embed.setDescription(profile.bio);
  }

  if (profile.favoriteQuote) {
    embed.addFields({
      name: 'Favorite quote',
      value: `*${profile.favoriteQuote}*`,
      inline: false,
    });
  }

  if (badges.length > 0) {
    // Cap visible badges at 5 (the spec'd slot limit) so the field stays
    // readable on mobile. If more exist we tack on a "+N" suffix.
    const visible = badges.slice(0, 5);
    const overflow = badges.length - visible.length;
    const value =
      visible.map((b) => `${b.badge.emoji} ${b.badge.name}`).join('  ') +
      (overflow > 0 ? `  +${overflow}` : '');
    embed.addFields({ name: `Badges (${badges.length})`, value, inline: false });
  }

  if (member?.joinedAt) {
    embed.addFields({
      name: 'Joined',
      value: time(member.joinedAt, TimestampStyles.RelativeTime),
      inline: true,
    });
  }

  if (levelInfo) {
    embed.addFields({
      name: 'Level',
      value:
        `**${levelInfo.level}** · ${levelInfo.xp} XP` +
        (levelInfo.rank !== null ? ` · #${levelInfo.rank}` : ''),
      inline: true,
    });
  }

  if (balance !== undefined && balance !== null) {
    embed.addFields({
      name: 'Balance',
      value: String(balance),
      inline: true,
    });
  }

  return embed;
}
