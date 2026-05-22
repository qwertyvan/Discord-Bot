import type { TemplateDiff, TemplatePayload } from '@discord-bot/shared';

/**
 * Diff a guild's current captured topology against a template payload.
 * Mirrors the server-side diff in apps/api/src/routes/templates.ts so the
 * bot can show a fully local preview before applying.
 */
export function diff(current: TemplatePayload, payload: TemplatePayload): TemplateDiff {
  return {
    roles: diffRoles(current.roles, payload.roles),
    channels: diffChannels(current.channels, payload.channels),
  };
}

function diffRoles(
  current: TemplatePayload['roles'],
  target: TemplatePayload['roles'],
): TemplateDiff['roles'] {
  const currentByName = new Map(current.map((r) => [r.name, r]));
  const targetByName = new Map(target.map((r) => [r.name, r]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ name: string; reason: string }> = [];

  for (const r of target) {
    const cur = currentByName.get(r.name);
    if (!cur) {
      added.push(r.name);
      continue;
    }
    const reasons: string[] = [];
    if (cur.color !== r.color) reasons.push('color');
    if (cur.hoist !== r.hoist) reasons.push('hoist');
    if (cur.mentionable !== r.mentionable) reasons.push('mentionable');
    if (cur.permissions !== r.permissions) reasons.push('permissions');
    if (reasons.length) changed.push({ name: r.name, reason: reasons.join(', ') });
  }
  for (const r of current) {
    if (!targetByName.has(r.name)) removed.push(r.name);
  }
  return { added, removed, changed };
}

function diffChannels(
  current: TemplatePayload['channels'],
  target: TemplatePayload['channels'],
): TemplateDiff['channels'] {
  const key = (c: TemplatePayload['channels'][number]) =>
    `${c.parentName ?? ''}::${c.name}`;
  const currentByKey = new Map(current.map((c) => [key(c), c]));
  const targetByKey = new Map(target.map((c) => [key(c), c]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ name: string; reason: string }> = [];

  for (const c of target) {
    const cur = currentByKey.get(key(c));
    if (!cur) {
      added.push(c.name);
      continue;
    }
    const reasons: string[] = [];
    if (cur.type !== c.type) reasons.push('type');
    if ((cur.topic ?? '') !== (c.topic ?? '')) reasons.push('topic');
    if (Boolean(cur.nsfw) !== Boolean(c.nsfw)) reasons.push('nsfw');
    if ((cur.slowmode ?? 0) !== (c.slowmode ?? 0)) reasons.push('slowmode');
    if (cur.overwrites.length !== c.overwrites.length) reasons.push('overwrites');
    if (reasons.length) changed.push({ name: c.name, reason: reasons.join(', ') });
  }
  for (const c of current) {
    if (!targetByKey.has(key(c))) removed.push(c.name);
  }
  return { added, removed, changed };
}
