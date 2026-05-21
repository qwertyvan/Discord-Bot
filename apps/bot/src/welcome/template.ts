import type { Guild, GuildMember, PartialGuildMember, User } from 'discord.js';

export interface WelcomeRenderContext {
  user: User;
  member?: GuildMember | PartialGuildMember;
  guild: Guild;
}

/**
 * Replaces placeholders in a welcome/leave template.
 * Supported placeholders:
 *   {user}        → mention (e.g. <@1234>)
 *   {username}    → display name without mention
 *   {server}      → guild name
 *   {memberCount} → current member count
 */
export function renderTemplate(template: string, ctx: WelcomeRenderContext): string {
  const displayName =
    (ctx.member && 'displayName' in ctx.member ? ctx.member.displayName : undefined) ??
    ctx.user.username;

  return template
    .replaceAll('{user}', `<@${ctx.user.id}>`)
    .replaceAll('{username}', displayName)
    .replaceAll('{server}', ctx.guild.name)
    .replaceAll('{memberCount}', String(ctx.guild.memberCount));
}
