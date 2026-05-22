import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ServerTemplate as PrismaServerTemplate } from '@prisma/client';
import { z } from 'zod';
import {
  CreateTemplateSchema,
  SnowflakeSchema,
  TemplatePayloadSchema,
  type TemplateChannel,
  type TemplateDiff,
  type TemplatePayload,
  type TemplateRole,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const TemplateParams = z.object({ id: z.string().uuid() });

function serialize(t: PrismaServerTemplate) {
  return {
    id: t.id,
    ownerGuildId: t.ownerGuildId,
    name: t.name,
    description: t.description,
    payload: t.payload as unknown as TemplatePayload,
    version: t.version,
    public: t.public,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function diffRoles(
  current: TemplateRole[],
  target: TemplateRole[],
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
  current: TemplateChannel[],
  target: TemplateChannel[],
): TemplateDiff['channels'] {
  const key = (c: TemplateChannel) => `${c.parentName ?? ''}::${c.name}`;
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

export const templatesRoutes: FastifyPluginAsyncZod = async (app) => {
  // List the templates owned by this guild.
  app.get(
    '/guilds/:guildId/templates',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.serverTemplate.findMany({
        where: { ownerGuildId: req.params.guildId },
        orderBy: { createdAt: 'desc' },
      });
      return { templates: items.map(serialize) };
    },
  );

  // Public registry — useful for cloning popular community structures.
  app.get(
    '/templates/public',
    {
      preHandler: app.requireBot(),
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const items = await app.prisma.serverTemplate.findMany({
        where: { public: true },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { templates: items.map(serialize) };
    },
  );

  // Fetch a single template. Allowed if it's the owner guild's bot context
  // OR the template is marked public.
  app.get(
    '/templates/:id',
    {
      preHandler: app.requireBot(),
      schema: {
        params: TemplateParams,
        querystring: z.object({ guildId: SnowflakeSchema.optional() }),
      },
    },
    async (req) => {
      const t = await app.prisma.serverTemplate.findUnique({
        where: { id: req.params.id },
      });
      if (!t) throw HttpError.notFound('Template not found.');
      if (!t.public && (!req.query.guildId || t.ownerGuildId !== req.query.guildId)) {
        throw HttpError.forbidden('Template is private to its owner guild.');
      }
      return serialize(t);
    },
  );

  // The bot captures the topology client-side (it has the live guild
  // reference) and POSTs the payload here.
  app.post(
    '/guilds/:guildId/templates/capture',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateTemplateSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const created = await app.prisma.serverTemplate.create({
        data: {
          ownerGuildId: guildId,
          name: req.body.name,
          description: req.body.description ?? null,
          createdBy: req.body.createdBy,
          payload: req.body.payload as unknown as object,
        },
      });
      return serialize(created);
    },
  );

  // Toggle whether the template appears in the public registry.
  app.post(
    '/templates/:id/share',
    { preHandler: app.requireBot(), schema: { params: TemplateParams } },
    async (req) => {
      const existing = await app.prisma.serverTemplate.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) throw HttpError.notFound('Template not found.');
      const updated = await app.prisma.serverTemplate.update({
        where: { id: req.params.id },
        data: { public: !existing.public },
      });
      return serialize(updated);
    },
  );

  // Diff: the bot POSTs the target guild's *current* captured payload as
  // the body; we compare it against the stored template's payload.
  app.post(
    '/templates/:id/diff',
    {
      preHandler: app.requireBot(),
      schema: {
        params: TemplateParams,
        querystring: z.object({ targetGuildId: SnowflakeSchema.optional() }),
        body: TemplatePayloadSchema,
      },
    },
    async (req) => {
      const t = await app.prisma.serverTemplate.findUnique({
        where: { id: req.params.id },
      });
      if (!t) throw HttpError.notFound('Template not found.');
      if (
        !t.public &&
        (!req.query.targetGuildId || t.ownerGuildId !== req.query.targetGuildId)
      ) {
        throw HttpError.forbidden('Template is private to its owner guild.');
      }
      const template = t.payload as unknown as TemplatePayload;
      const current = req.body;
      return {
        roles: diffRoles(current.roles, template.roles),
        channels: diffChannels(current.channels, template.channels),
      } satisfies TemplateDiff;
    },
  );

  app.delete(
    '/templates/:id',
    { preHandler: app.requireBot(), schema: { params: TemplateParams } },
    async (req, reply) => {
      const result = await app.prisma.serverTemplate.deleteMany({
        where: { id: req.params.id },
      });
      if (result.count === 0) throw HttpError.notFound('Template not found.');
      return reply.code(204).send();
    },
  );
};
