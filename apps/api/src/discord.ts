/**
 * Thin wrapper around the small set of Discord REST endpoints we hit from the API.
 */

const API = 'https://discord.com/api/v10';

export interface DiscordUserInfo {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordPartialGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

export class DiscordAuthError extends Error {
  constructor() {
    super('Discord rejected the access token.');
    this.name = 'DiscordAuthError';
  }
}

async function fetchDiscord<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new DiscordAuthError();
  if (!res.ok) {
    throw new Error(`Discord API ${path} returned ${res.status}`);
  }
  return (await res.json()) as T;
}

export function getCurrentUser(accessToken: string): Promise<DiscordUserInfo> {
  return fetchDiscord<DiscordUserInfo>('/users/@me', accessToken);
}

export function getUserGuilds(accessToken: string): Promise<DiscordPartialGuild[]> {
  return fetchDiscord<DiscordPartialGuild[]>('/users/@me/guilds', accessToken);
}

export function userAvatarUrl(user: { id: string; avatar: string | null }): string | null {
  if (!user.avatar) return null;
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}`;
}

export function guildIconUrl(guild: { id: string; icon: string | null }): string | null {
  if (!guild.icon) return null;
  const ext = guild.icon.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}`;
}
