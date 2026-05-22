import { ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';
import type {
  TemplateChannel,
  TemplateOverwrite,
  TemplatePayload,
  TemplateRole,
} from '@discord-bot/shared';

/**
 * Read a guild's structural topology — roles, channels, permission
 * overwrites, ordering — and return it as a TemplatePayload. The output is
 * what gets POSTed to /guilds/:id/templates/capture and is the same shape
 * the API hands back for diffing and applying.
 *
 * Side-effect free; we never touch the guild here.
 */
export function captureGuild(guild: Guild): TemplatePayload {
  const roleById = new Map<string, string>(); // id → name
  const roles: TemplateRole[] = [];

  // Sort roles by descending position so hierarchy is preserved when later
  // recreated. @everyone is included because we still need its overwrites
  // resolved, but apply skips creating it.
  const sortedRoles = [...guild.roles.cache.values()].sort(
    (a, b) => b.position - a.position,
  );
  for (const role of sortedRoles) {
    roleById.set(role.id, role.name);
    if (role.managed) continue; // bot/integration roles — Discord owns them.
    roles.push({
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield.toString(),
    });
  }

  const channels: TemplateChannel[] = [];
  const channelArr = [...guild.channels.cache.values()].sort(
    (a, b) => ('position' in a ? a.position : 0) - ('position' in b ? b.position : 0),
  );
  for (const channel of channelArr) {
    if (!isCapturable(channel)) continue;
    const overwrites: TemplateOverwrite[] = [];
    if ('permissionOverwrites' in channel) {
      for (const ow of channel.permissionOverwrites.cache.values()) {
        // Skip member overwrites — templates are structural, not personal.
        if (ow.type !== 0) continue;
        const roleName = roleById.get(ow.id);
        overwrites.push({
          // For @everyone (role id === guild id) we omit roleName so apply
          // resolves it to the destination guild's @everyone.
          ...(roleName && ow.id !== guild.id ? { roleName } : {}),
          allow: ow.allow.bitfield.toString(),
          deny: ow.deny.bitfield.toString(),
        });
      }
    }

    const parent = channel.parent;
    const topic = 'topic' in channel ? (channel.topic ?? undefined) : undefined;
    const nsfw = 'nsfw' in channel ? channel.nsfw : undefined;
    const slowmode =
      'rateLimitPerUser' in channel ? (channel.rateLimitPerUser ?? undefined) : undefined;

    channels.push({
      name: channel.name,
      type: channel.type,
      position: 'position' in channel ? channel.position : 0,
      ...(parent ? { parentName: parent.name } : {}),
      ...(topic ? { topic } : {}),
      ...(nsfw !== undefined ? { nsfw } : {}),
      ...(slowmode !== undefined ? { slowmode } : {}),
      overwrites,
    });
  }

  return { roles, channels };
}

/**
 * Channel types we actually clone. Threads are intentionally skipped —
 * they're per-message artefacts, not part of the persistent structure.
 */
function isCapturable(channel: GuildBasedChannel): boolean {
  switch (channel.type) {
    case ChannelType.GuildText:
    case ChannelType.GuildVoice:
    case ChannelType.GuildCategory:
    case ChannelType.GuildAnnouncement:
    case ChannelType.GuildStageVoice:
    case ChannelType.GuildForum:
      return true;
    default:
      return false;
  }
}
