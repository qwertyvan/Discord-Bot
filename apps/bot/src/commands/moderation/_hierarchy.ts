import type { GuildMember } from 'discord.js';

/**
 * Hierarchy check for moderation actions. Returns an error message if the
 * invoker is not allowed to act on the target, or null if they are.
 *
 * Rules:
 *  - The invoker may not target themselves.
 *  - The invoker may not target the guild owner.
 *  - If the invoker is the guild owner, they may target anyone.
 *  - Otherwise, the invoker's highest role must rank strictly higher than the
 *    target's highest role. (Discord enforces the same for the bot via the
 *    `.kickable` / `.bannable` / `.moderatable` flags; this check covers the
 *    moderator, which Discord doesn't enforce server-side.)
 */
export function checkModerationHierarchy(
  invoker: GuildMember,
  target: GuildMember,
): string | null {
  if (invoker.id === target.id) return 'You cannot moderate yourself.';
  if (target.id === target.guild.ownerId) return 'You cannot moderate the server owner.';
  if (invoker.id === invoker.guild.ownerId) return null;
  if (target.roles.highest.position >= invoker.roles.highest.position) {
    return 'Your highest role must be above the target user\'s highest role.';
  }
  return null;
}
