/**
 * Discord permission bit helpers, used to decide whether an authenticated user
 * may administer a guild from the web dashboard.
 *
 * Bit reference: https://discord.com/developers/docs/topics/permissions
 */

export const DiscordPermissions = {
  Administrator: 1n << 3n,
  ManageGuild: 1n << 5n,
} as const;

export function hasManageGuild(permissions: bigint | string | number): boolean {
  const bits = typeof permissions === 'bigint' ? permissions : BigInt(permissions);
  return (
    (bits & DiscordPermissions.Administrator) === DiscordPermissions.Administrator ||
    (bits & DiscordPermissions.ManageGuild) === DiscordPermissions.ManageGuild
  );
}
