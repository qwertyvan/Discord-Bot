import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AuditEventTypeSchema,
  ModActionListQuerySchema,
  ModActionTypeSchema,
  SnowflakeSchema,
  UpdateAutomodConfigSchema,
  UpdateLoggingConfigSchema,
  UpdateWarningPolicySchema,
  UpdateWelcomeConfigSchema,
} from '@discord-bot/shared';
import { HttpError } from '../../errors.js';
import { DiscordAuthError } from '../../discord.js';
import {
  getManageableGuilds,
  guildIconUrl,
  invalidatePermissionsCache,
} from '../../guild-permissions.js';
import { serializeModAction } from '../../services/mod-actions.js';

const Params = z.object({ guildId: SnowflakeSchema });
const ActionParams = z.object({ guildId: SnowflakeSchema, actionId: z.string().uuid() });
const NoteParams = z.object({ guildId: SnowflakeSchema, noteId: z.string().uuid() });

async function withDiscordAuth<T>(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DiscordAuthError && req.user) {
      await app.prisma.session.delete({ where: { id: req.user.sessionId } }).catch(() => {});
      invalidatePermissionsCache(req.user.userId);
      app.clearSession(reply);
      throw HttpError.unauthorized('Discord session expired. Please sign in again.');
    }
    throw err;
  }
}

async function ensureGuildAccess(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  guildId: string,
): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const dbUser = await app.prisma.adminUser.findUnique({
    where: { discordId: req.user.userId },
  });
  if (!dbUser) throw HttpError.unauthorized();

  const manageable = await withDiscordAuth(app, req, reply, () =>
    getManageableGuilds(dbUser.discordId, dbUser.accessToken),
  );
  if (!manageable.some((g) => g.id === guildId)) {
    throw HttpError.forbidden('You do not have Manage Server on this guild.');
  }

  const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) throw HttpError.notFound('Bot is not in that guild.');
}

export const adminGuildsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireSession());

  // ─── Guild list ──────────────────────────────────────────────────────
  app.get('/admin/guilds', async (req, reply) => {
    if (!req.user) throw HttpError.unauthorized();
    const dbUser = await app.prisma.adminUser.findUnique({
      where: { discordId: req.user.userId },
    });
    if (!dbUser) throw HttpError.unauthorized();

    const manageable = await withDiscordAuth(app, req, reply, () =>
      getManageableGuilds(dbUser.discordId, dbUser.accessToken),
    );
    const manageableIds = new Set(manageable.map((g) => g.id));

    const botGuilds = await app.prisma.guild.findMany({
      where: { id: { in: [...manageableIds] } },
      orderBy: { name: 'asc' },
    });

    return {
      guilds: botGuilds.map((g) => ({
        id: g.id,
        name: g.name,
        iconUrl:
          g.iconUrl ??
          guildIconUrl(manageable.find((m) => m.id === g.id) ?? { id: g.id, icon: null }),
        addedAt: g.addedAt.toISOString(),
      })),
    };
  });

  // ─── Stats ────────────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/stats',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);

      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
      const [warningCount, warningsLast7d, modActionsLast7d, activeWarnings, welcome, logging] =
        await Promise.all([
          app.prisma.modAction.count({ where: { guildId, type: 'WARN' } }),
          app.prisma.modAction.count({
            where: { guildId, type: 'WARN', createdAt: { gte: sevenDaysAgo } },
          }),
          app.prisma.modAction.count({ where: { guildId, createdAt: { gte: sevenDaysAgo } } }),
          app.prisma.modAction.count({ where: { guildId, type: 'WARN', active: true } }),
          app.prisma.welcomeConfig.findUnique({ where: { guildId } }),
          app.prisma.loggingConfig.findUnique({ where: { guildId } }),
        ]);

      return {
        guildId,
        warningCount,
        warningsLast7d,
        modActionsLast7d,
        activeWarnings,
        welcomeEnabled: welcome?.enabled ?? false,
        loggingEnabled: logging?.enabled ?? false,
      };
    },
  );

  // ─── Mod actions ──────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/mod-actions',
    { schema: { params: Params, querystring: ModActionListQuerySchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const { userId, type, limit, cursor } = req.query;
      const where = {
        guildId,
        ...(userId ? { userId } : {}),
        ...(type ? { type } : {}),
      };
      const items = await app.prisma.modAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const last = page[page.length - 1];
      return {
        actions: page.map(serializeModAction),
        nextCursor: hasMore && last ? last.id : null,
      };
    },
  );

  app.delete(
    '/admin/guilds/:guildId/mod-actions/:actionId',
    { schema: { params: ActionParams } },
    async (req, reply) => {
      const { guildId, actionId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const result = await app.prisma.modAction.deleteMany({
        where: { id: actionId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Mod action not found.');
      return reply.code(204).send();
    },
  );

  // ─── Mod notes ────────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/users/:userId/mod-notes',
    {
      schema: { params: z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema }) },
    },
    async (req, reply) => {
      const { guildId, userId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const notes = await app.prisma.modNote.findMany({
        where: { guildId, userId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        notes: notes.map((n) => ({
          id: n.id,
          guildId: n.guildId,
          userId: n.userId,
          moderatorId: n.moderatorId,
          content: n.content,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  );

  app.delete(
    '/admin/guilds/:guildId/mod-notes/:noteId',
    { schema: { params: NoteParams } },
    async (req, reply) => {
      const { guildId, noteId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const result = await app.prisma.modNote.deleteMany({
        where: { id: noteId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Note not found.');
      return reply.code(204).send();
    },
  );

  // ─── Audit log ────────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/audit-events',
    {
      schema: {
        params: Params,
        querystring: z.object({
          type: AuditEventTypeSchema.optional(),
          userId: SnowflakeSchema.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const { type, userId, limit } = req.query;
      const events = await app.prisma.auditEvent.findMany({
        where: {
          guildId,
          ...(type ? { type } : {}),
          ...(userId ? { userId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return {
        events: events.map((e) => ({
          id: e.id,
          guildId: e.guildId,
          type: e.type,
          userId: e.userId,
          channelId: e.channelId,
          payload: e.payload as Record<string, unknown>,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },
  );

  // ─── Logging config ───────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/logging-config',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const cfg = await app.prisma.loggingConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: cfg?.enabled ?? false,
        channelId: cfg?.channelId ?? null,
        events: (cfg?.events as Record<string, boolean>) ?? {},
      };
    },
  );

  app.put(
    '/admin/guilds/:guildId/logging-config',
    { schema: { params: Params, body: UpdateLoggingConfigSchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.events !== undefined) update.events = patch.events;

      const cfg = await app.prisma.loggingConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          events: patch.events ?? {},
        },
      });
      return {
        guildId: cfg.guildId,
        enabled: cfg.enabled,
        channelId: cfg.channelId,
        events: (cfg.events as Record<string, boolean>) ?? {},
      };
    },
  );

  // ─── Warning policy ───────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/warning-policy',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const p = await app.prisma.warningPolicy.findUnique({ where: { guildId } });
      return {
        guildId,
        expireDays: p?.expireDays ?? null,
        thresholds: (p?.thresholds as unknown[]) ?? [],
        muteRoleId: p?.muteRoleId ?? null,
      };
    },
  );

  app.put(
    '/admin/guilds/:guildId/warning-policy',
    { schema: { params: Params, body: UpdateWarningPolicySchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.expireDays !== undefined) update.expireDays = patch.expireDays;
      if (patch.thresholds !== undefined) update.thresholds = patch.thresholds;
      if (patch.muteRoleId !== undefined) update.muteRoleId = patch.muteRoleId;

      const policy = await app.prisma.warningPolicy.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          expireDays: patch.expireDays ?? null,
          thresholds: patch.thresholds ?? [],
          muteRoleId: patch.muteRoleId ?? null,
        },
      });
      return {
        guildId: policy.guildId,
        expireDays: policy.expireDays,
        thresholds: policy.thresholds as unknown[],
        muteRoleId: policy.muteRoleId,
      };
    },
  );

  // ─── Welcome config ──────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/welcome',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const config = await app.prisma.welcomeConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: config?.enabled ?? false,
        channelId: config?.channelId ?? null,
        joinTemplate: config?.joinTemplate ?? null,
        leaveTemplate: config?.leaveTemplate ?? null,
      };
    },
  );

  app.put(
    '/admin/guilds/:guildId/welcome',
    { schema: { params: Params, body: UpdateWelcomeConfigSchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.joinTemplate !== undefined) update.joinTemplate = patch.joinTemplate;
      if (patch.leaveTemplate !== undefined) update.leaveTemplate = patch.leaveTemplate;

      const config = await app.prisma.welcomeConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          joinTemplate: patch.joinTemplate ?? null,
          leaveTemplate: patch.leaveTemplate ?? null,
        },
      });
      return {
        guildId: config.guildId,
        enabled: config.enabled,
        channelId: config.channelId,
        joinTemplate: config.joinTemplate,
        leaveTemplate: config.leaveTemplate,
      };
    },
  );

  // ─── Automod config + hits ────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/automod-config',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const cfg = await app.prisma.automodConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: cfg?.enabled ?? false,
        exemptRoleIds: (cfg?.exemptRoleIds as string[]) ?? [],
        exemptChannelIds: (cfg?.exemptChannelIds as string[]) ?? [],
        rules: (cfg?.rules as Record<string, unknown>) ?? {},
      };
    },
  );

  app.put(
    '/admin/guilds/:guildId/automod-config',
    { schema: { params: Params, body: UpdateAutomodConfigSchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.exemptRoleIds !== undefined) update.exemptRoleIds = patch.exemptRoleIds;
      if (patch.exemptChannelIds !== undefined) update.exemptChannelIds = patch.exemptChannelIds;
      if (patch.rules !== undefined) update.rules = patch.rules;

      const cfg = await app.prisma.automodConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          exemptRoleIds: patch.exemptRoleIds ?? [],
          exemptChannelIds: patch.exemptChannelIds ?? [],
          rules: patch.rules ?? {},
        },
      });
      return {
        guildId: cfg.guildId,
        enabled: cfg.enabled,
        exemptRoleIds: (cfg.exemptRoleIds as string[]) ?? [],
        exemptChannelIds: (cfg.exemptChannelIds as string[]) ?? [],
        rules: (cfg.rules as Record<string, unknown>) ?? {},
      };
    },
  );

  app.get(
    '/admin/guilds/:guildId/automod-hits',
    {
      schema: {
        params: Params,
        querystring: z.object({
          userId: SnowflakeSchema.optional(),
          rule: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const { userId, rule, limit } = req.query;
      const hits = await app.prisma.automodHit.findMany({
        where: {
          guildId,
          ...(userId ? { userId } : {}),
          ...(rule ? { rule } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return {
        hits: hits.map((h) => ({
          id: h.id,
          guildId: h.guildId,
          userId: h.userId,
          channelId: h.channelId,
          rule: h.rule,
          action: h.action,
          reason: h.reason,
          payload: h.payload as Record<string, unknown>,
          createdAt: h.createdAt.toISOString(),
        })),
      };
    },
  );

  // Note: re-exported schemas keep the type union compile-coupled to the
  // dashboard even though no route uses them directly.
  void ModActionTypeSchema;
};
