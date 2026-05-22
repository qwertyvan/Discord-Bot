import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  LinkSafetyConfig as PrismaLinkSafetyConfig,
  LinkDomain as PrismaLinkDomain,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateLinkDomainSchema,
  LinkDomainKindSchema,
  SnowflakeSchema,
  UpsertLinkSafetyConfigSchema,
  type LinkSafetyAction,
  type LinkSafetyMode,
  type LinkDomainKind,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const DomainParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });
const KindQuery = z.object({ kind: LinkDomainKindSchema.optional() });

function serializeConfig(guildId: string, cfg: PrismaLinkSafetyConfig | null) {
  return {
    guildId,
    enabled: cfg?.enabled ?? false,
    mode: (cfg?.mode ?? 'blocklist') as LinkSafetyMode,
    action: (cfg?.action ?? 'delete') as LinkSafetyAction,
    muteMinutes: cfg?.muteMinutes ?? 10,
    notifyChannelId: cfg?.notifyChannelId ?? null,
    expandShorteners: cfg?.expandShorteners ?? true,
    gsbCheck: cfg?.gsbCheck ?? false,
  };
}

function serializeDomain(d: PrismaLinkDomain) {
  return {
    id: d.id,
    guildId: d.guildId,
    domain: d.domain,
    kind: d.kind as LinkDomainKind,
    addedBy: d.addedBy,
    addedAt: d.addedAt.toISOString(),
  };
}

export const linkSafetyRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Config ─────────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/link-safety-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.linkSafetyConfig.findUnique({ where: { guildId } });
      return serializeConfig(guildId, cfg);
    },
  );

  // Lightweight "is link-safety enabled here?" probe for the bot's hot path.
  // Returns the same shape as the main config so callers can cache one response.
  app.get(
    '/guilds/:guildId/link-safety-config/enabled',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.linkSafetyConfig.findUnique({ where: { guildId } });
      return serializeConfig(guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/link-safety-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertLinkSafetyConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;

      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.mode !== undefined) update.mode = patch.mode;
      if (patch.action !== undefined) update.action = patch.action;
      if (patch.muteMinutes !== undefined) update.muteMinutes = patch.muteMinutes;
      if (patch.notifyChannelId !== undefined) update.notifyChannelId = patch.notifyChannelId;
      if (patch.expandShorteners !== undefined) update.expandShorteners = patch.expandShorteners;
      if (patch.gsbCheck !== undefined) update.gsbCheck = patch.gsbCheck;

      const cfg = await app.prisma.linkSafetyConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          mode: patch.mode ?? 'blocklist',
          action: patch.action ?? 'delete',
          muteMinutes: patch.muteMinutes ?? 10,
          notifyChannelId: patch.notifyChannelId ?? null,
          expandShorteners: patch.expandShorteners ?? true,
          gsbCheck: patch.gsbCheck ?? false,
        },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  // ── Domains ────────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/link-domains',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, querystring: KindQuery },
    },
    async (req) => {
      const items = await app.prisma.linkDomain.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.kind ? { kind: req.query.kind } : {}),
        },
        orderBy: { addedAt: 'desc' },
      });
      return { domains: items.map(serializeDomain) };
    },
  );

  app.post(
    '/guilds/:guildId/link-domains',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateLinkDomainSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const domain = req.body.domain.toLowerCase().trim();
      const existing = await app.prisma.linkDomain.findUnique({
        where: { guildId_domain_kind: { guildId, domain, kind: req.body.kind } },
      });
      if (existing) return serializeDomain(existing);
      const created = await app.prisma.linkDomain.create({
        data: {
          guildId,
          domain,
          kind: req.body.kind,
          addedBy: req.body.addedBy,
        },
      });
      return serializeDomain(created);
    },
  );

  app.delete(
    '/guilds/:guildId/link-domains/:id',
    { preHandler: app.requireBot(), schema: { params: DomainParams } },
    async (req, reply) => {
      const result = await app.prisma.linkDomain.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Domain not found.');
      return reply.code(204).send();
    },
  );
};
