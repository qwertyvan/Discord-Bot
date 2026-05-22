import {
  ChannelType,
  PermissionsBitField,
  type Guild,
  type GuildChannelCreateOptions,
  type OverwriteResolvable,
  type Role,
} from 'discord.js';
import type { TemplateApplyReport, TemplatePayload } from '@discord-bot/shared';

export interface ApplyOptions {
  // 'skip'   → leave existing role/channel alone if a name collides.
  // 'rename' → suffix the new item with " (template)" and create anyway.
  onConflict: 'skip' | 'rename';
}

/**
 * Apply a template payload to `guild`. We ONLY create missing items;
 * existing roles/channels are left untouched and never deleted. Each create
 * is wrapped in try/catch so rate-limit hiccups or single failures don't
 * abort the whole apply — the report tells callers exactly what landed.
 */
export async function applyTemplate(
  guild: Guild,
  payload: TemplatePayload,
  options: ApplyOptions,
): Promise<TemplateApplyReport> {
  const report: TemplateApplyReport = {
    rolesCreated: [],
    rolesSkipped: [],
    channelsCreated: [],
    channelsSkipped: [],
    errors: [],
  };

  // ─── Roles ─────────────────────────────────────────────────────────
  // Preserve hierarchy by creating in the payload's order (highest first).
  const existingRoles = new Map<string, Role>(
    guild.roles.cache.map((r) => [r.name, r]),
  );

  for (const role of payload.roles) {
    if (existingRoles.has(role.name)) {
      if (options.onConflict === 'skip') {
        report.rolesSkipped.push(role.name);
        continue;
      }
    }
    const finalName =
      existingRoles.has(role.name) && options.onConflict === 'rename'
        ? `${role.name} (template)`
        : role.name;
    try {
      const created = await guild.roles.create({
        name: finalName,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: new PermissionsBitField(BigInt(role.permissions)),
        reason: 'Server template apply',
      });
      existingRoles.set(created.name, created);
      report.rolesCreated.push(finalName);
    } catch (err) {
      report.errors.push({
        kind: 'role',
        name: finalName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Channels ──────────────────────────────────────────────────────
  // Categories first so child channels can reference their parent. Within
  // each pass we honour the captured ordering.
  const categories = payload.channels.filter(
    (c) => c.type === ChannelType.GuildCategory,
  );
  const nonCategories = payload.channels.filter(
    (c) => c.type !== ChannelType.GuildCategory,
  );
  const existingChannelsByName = new Map(
    guild.channels.cache.map((c) => [c.name, c]),
  );

  const newCategoryByName = new Map<string, string>(); // captured name → created id
  for (const cat of [...categories].sort((a, b) => a.position - b.position)) {
    if (existingChannelsByName.has(cat.name) && options.onConflict === 'skip') {
      report.channelsSkipped.push(cat.name);
      const existing = existingChannelsByName.get(cat.name);
      if (existing) newCategoryByName.set(cat.name, existing.id);
      continue;
    }
    const finalName =
      existingChannelsByName.has(cat.name) && options.onConflict === 'rename'
        ? `${cat.name} (template)`
        : cat.name;
    try {
      const created = await guild.channels.create({
        name: finalName,
        type: ChannelType.GuildCategory,
        position: cat.position,
        permissionOverwrites: buildOverwrites(guild, cat.overwrites),
        reason: 'Server template apply',
      });
      newCategoryByName.set(cat.name, created.id);
      report.channelsCreated.push(finalName);
    } catch (err) {
      report.errors.push({
        kind: 'channel',
        name: finalName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const ch of [...nonCategories].sort((a, b) => a.position - b.position)) {
    if (existingChannelsByName.has(ch.name) && options.onConflict === 'skip') {
      report.channelsSkipped.push(ch.name);
      continue;
    }
    const finalName =
      existingChannelsByName.has(ch.name) && options.onConflict === 'rename'
        ? `${ch.name} (template)`
        : ch.name;
    const parentId = ch.parentName ? newCategoryByName.get(ch.parentName) : undefined;
    // Build the options dict carefully — exactOptionalPropertyTypes forbids
    // passing `undefined` for keys that don't allow it.
    const options_: GuildChannelCreateOptions = {
      name: finalName,
      type: ch.type as Exclude<GuildChannelCreateOptions['type'], undefined>,
      position: ch.position,
      permissionOverwrites: buildOverwrites(guild, ch.overwrites),
      reason: 'Server template apply',
      ...(parentId ? { parent: parentId } : {}),
      ...(ch.topic ? { topic: ch.topic } : {}),
      ...(ch.nsfw !== undefined ? { nsfw: ch.nsfw } : {}),
      ...(ch.slowmode !== undefined ? { rateLimitPerUser: ch.slowmode } : {}),
    };
    try {
      await guild.channels.create(options_);
      report.channelsCreated.push(finalName);
    } catch (err) {
      report.errors.push({
        kind: 'channel',
        name: finalName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

/**
 * Convert captured overwrites (referencing roles by name) into the
 * resolved-id payload Discord expects. Skips overwrites for roles we
 * couldn't resolve in the target guild.
 */
function buildOverwrites(
  guild: Guild,
  overwrites: TemplatePayload['channels'][number]['overwrites'],
): OverwriteResolvable[] {
  const result: OverwriteResolvable[] = [];
  for (const ow of overwrites) {
    const id = ow.roleName
      ? guild.roles.cache.find((r) => r.name === ow.roleName)?.id
      : guild.roles.everyone.id;
    if (!id) continue;
    result.push({
      id,
      allow: new PermissionsBitField(BigInt(ow.allow)),
      deny: new PermissionsBitField(BigInt(ow.deny)),
    });
  }
  return result;
}
