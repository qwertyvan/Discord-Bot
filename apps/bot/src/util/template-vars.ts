import type { Guild, User } from 'discord.js';

export interface TemplateContext {
  user: User;
  guild: Guild;
}

/**
 * Render the shared template-variable syntax used by tags and custom
 * commands. Supported placeholders:
 *   {user}             — mention (e.g. <@123>)
 *   {username}         — display name without ping
 *   {server}           — guild name
 *   {memberCount}      — guild member count
 *   {random:a,b,c}     — picks one at random
 */
const PATTERN = /\{(user|username|server|memberCount|random:[^}]*)\}/g;

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(PATTERN, (_, token: string) => {
    if (token === 'user') return `<@${ctx.user.id}>`;
    if (token === 'username') return ctx.user.globalName ?? ctx.user.username;
    if (token === 'server') return ctx.guild.name;
    if (token === 'memberCount') return String(ctx.guild.memberCount);
    if (token.startsWith('random:')) {
      const opts = token
        .slice('random:'.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (opts.length === 0) return '';
      return opts[Math.floor(Math.random() * opts.length)]!;
    }
    return `{${token}}`;
  });
}
