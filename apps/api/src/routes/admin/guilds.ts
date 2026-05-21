import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AuditEventTypeSchema,
  ModActionListQuerySchema,
  ModActionTypeSchema,
  SnowflakeSchema,
  UpdateAutomodConfigSchema,
  UpdateEconomyConfigSchema,
  UpdateLevelConfigSchema,
  UpdateLoggingConfigSchema,
  UpdateTicketConfigSchema,
  UpdateVerificationConfigSchema,
  UpdateWarningPolicySchema,
  UpdateWelcomeConfigSchema,
  levelFromXp,
} from '@discord-bot/shared';
import { HttpError } from '../../errors.js';
import { DiscordAuthError } from '../../discord.js';
import { channelHeatmap, memberGrowth, modActionsTrend, topTargets } from '../stats.js';
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
      const cfg = await app.prisma.welcomeConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: cfg?.enabled ?? false,
        channelId: cfg?.channelId ?? null,
        joinTemplate: cfg?.joinTemplate ?? null,
        leaveTemplate: cfg?.leaveTemplate ?? null,
        dmTemplate: cfg?.dmTemplate ?? null,
        autoRoleIds: (cfg?.autoRoleIds as string[]) ?? [],
        milestoneEvery: cfg?.milestoneEvery ?? null,
        milestoneTemplate: cfg?.milestoneTemplate ?? null,
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
      if (patch.dmTemplate !== undefined) update.dmTemplate = patch.dmTemplate;
      if (patch.autoRoleIds !== undefined) update.autoRoleIds = patch.autoRoleIds;
      if (patch.milestoneEvery !== undefined) update.milestoneEvery = patch.milestoneEvery;
      if (patch.milestoneTemplate !== undefined) update.milestoneTemplate = patch.milestoneTemplate;

      const cfg = await app.prisma.welcomeConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          joinTemplate: patch.joinTemplate ?? null,
          leaveTemplate: patch.leaveTemplate ?? null,
          dmTemplate: patch.dmTemplate ?? null,
          autoRoleIds: patch.autoRoleIds ?? [],
          milestoneEvery: patch.milestoneEvery ?? null,
          milestoneTemplate: patch.milestoneTemplate ?? null,
        },
      });
      return {
        guildId: cfg.guildId,
        enabled: cfg.enabled,
        channelId: cfg.channelId,
        joinTemplate: cfg.joinTemplate,
        leaveTemplate: cfg.leaveTemplate,
        dmTemplate: cfg.dmTemplate,
        autoRoleIds: (cfg.autoRoleIds as string[]) ?? [],
        milestoneEvery: cfg.milestoneEvery,
        milestoneTemplate: cfg.milestoneTemplate,
      };
    },
  );

  // ─── Verification config ──────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/verification',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const cfg = await app.prisma.verificationConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: cfg?.enabled ?? false,
        channelId: cfg?.channelId ?? null,
        messageId: cfg?.messageId ?? null,
        verifiedRoleId: cfg?.verifiedRoleId ?? null,
        buttonLabel: cfg?.buttonLabel ?? null,
        prompt: cfg?.prompt ?? null,
      };
    },
  );

  app.put(
    '/admin/guilds/:guildId/verification',
    { schema: { params: Params, body: UpdateVerificationConfigSchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.messageId !== undefined) update.messageId = patch.messageId;
      if (patch.verifiedRoleId !== undefined) update.verifiedRoleId = patch.verifiedRoleId;
      if (patch.buttonLabel !== undefined) update.buttonLabel = patch.buttonLabel;
      if (patch.prompt !== undefined) update.prompt = patch.prompt;

      const cfg = await app.prisma.verificationConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          messageId: patch.messageId ?? null,
          verifiedRoleId: patch.verifiedRoleId ?? null,
          buttonLabel: patch.buttonLabel ?? null,
          prompt: patch.prompt ?? null,
        },
      });
      return {
        guildId: cfg.guildId,
        enabled: cfg.enabled,
        channelId: cfg.channelId,
        messageId: cfg.messageId,
        verifiedRoleId: cfg.verifiedRoleId,
        buttonLabel: cfg.buttonLabel,
        prompt: cfg.prompt,
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

  // ─── Leveling ─────────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/level-config',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const cfg = await app.prisma.levelConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: cfg?.enabled ?? false,
        perMessageXp: cfg?.perMessageXp ?? 15,
        textCooldownSeconds: cfg?.textCooldownSeconds ?? 60,
        voiceXpPerMinute: cfg?.voiceXpPerMinute ?? 5,
        levelUpChannelId: cfg?.levelUpChannelId ?? null,
        levelUpTemplate: cfg?.levelUpTemplate ?? null,
        channelMultipliers: (cfg?.channelMultipliers as Record<string, number>) ?? {},
        roleRewards: (cfg?.roleRewards as Array<{ level: number; roleId: string }>) ?? [],
        noXpRoleIds: (cfg?.noXpRoleIds as string[]) ?? [],
      };
    },
  );

  app.put(
    '/admin/guilds/:guildId/level-config',
    { schema: { params: Params, body: UpdateLevelConfigSchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const patch = req.body;
      const update: Record<string, unknown> = {};
      for (const k of [
        'enabled',
        'perMessageXp',
        'textCooldownSeconds',
        'voiceXpPerMinute',
        'levelUpChannelId',
        'levelUpTemplate',
        'channelMultipliers',
        'roleRewards',
        'noXpRoleIds',
      ] as const) {
        const v = (patch as Record<string, unknown>)[k];
        if (v !== undefined) update[k] = v;
      }
      const cfg = await app.prisma.levelConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          perMessageXp: patch.perMessageXp ?? 15,
          textCooldownSeconds: patch.textCooldownSeconds ?? 60,
          voiceXpPerMinute: patch.voiceXpPerMinute ?? 5,
          levelUpChannelId: patch.levelUpChannelId ?? null,
          levelUpTemplate: patch.levelUpTemplate ?? null,
          channelMultipliers: patch.channelMultipliers ?? {},
          roleRewards: patch.roleRewards ?? [],
          noXpRoleIds: patch.noXpRoleIds ?? [],
        },
      });
      return {
        guildId: cfg.guildId,
        enabled: cfg.enabled,
        perMessageXp: cfg.perMessageXp,
        textCooldownSeconds: cfg.textCooldownSeconds,
        voiceXpPerMinute: cfg.voiceXpPerMinute,
        levelUpChannelId: cfg.levelUpChannelId,
        levelUpTemplate: cfg.levelUpTemplate,
        channelMultipliers: cfg.channelMultipliers as Record<string, number>,
        roleRewards: cfg.roleRewards as Array<{ level: number; roleId: string }>,
        noXpRoleIds: cfg.noXpRoleIds as string[],
      };
    },
  );

  app.get(
    '/admin/guilds/:guildId/leaderboard',
    {
      schema: {
        params: Params,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const top = await app.prisma.memberLevel.findMany({
        where: { guildId },
        orderBy: { xp: 'desc' },
        take: req.query.limit,
      });
      return {
        entries: top.map((m, i) => ({
          rank: i + 1,
          guildId,
          userId: m.userId,
          xp: m.xp,
          voiceMinutes: m.voiceMinutes,
          level: levelFromXp(m.xp),
        })),
      };
    },
  );

  // ─── Economy ──────────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/economy-config',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const cfg = await app.prisma.economyConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: cfg?.enabled ?? false,
        currencyName: cfg?.currencyName ?? 'coins',
        currencySymbol: cfg?.currencySymbol ?? '🪙',
        startingBalance: cfg?.startingBalance ?? 0,
        dailyReward: cfg?.dailyReward ?? 100,
        dailyCooldownSeconds: cfg?.dailyCooldownSeconds ?? 86_400,
        workMin: cfg?.workMin ?? 20,
        workMax: cfg?.workMax ?? 80,
        workCooldownSeconds: cfg?.workCooldownSeconds ?? 3600,
        gamblingEnabled: cfg?.gamblingEnabled ?? true,
      };
    },
  );

  app.put(
    '/admin/guilds/:guildId/economy-config',
    { schema: { params: Params, body: UpdateEconomyConfigSchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const patch = req.body;
      const update: Record<string, unknown> = {};
      for (const k of [
        'enabled',
        'currencyName',
        'currencySymbol',
        'startingBalance',
        'dailyReward',
        'dailyCooldownSeconds',
        'workMin',
        'workMax',
        'workCooldownSeconds',
        'gamblingEnabled',
      ] as const) {
        const v = (patch as Record<string, unknown>)[k];
        if (v !== undefined) update[k] = v;
      }
      const cfg = await app.prisma.economyConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          currencyName: patch.currencyName ?? 'coins',
          currencySymbol: patch.currencySymbol ?? '🪙',
          startingBalance: patch.startingBalance ?? 0,
          dailyReward: patch.dailyReward ?? 100,
          dailyCooldownSeconds: patch.dailyCooldownSeconds ?? 86_400,
          workMin: patch.workMin ?? 20,
          workMax: patch.workMax ?? 80,
          workCooldownSeconds: patch.workCooldownSeconds ?? 3600,
          gamblingEnabled: patch.gamblingEnabled ?? true,
        },
      });
      return cfg;
    },
  );

  app.get(
    '/admin/guilds/:guildId/economy-leaderboard',
    {
      schema: {
        params: Params,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const top = await app.prisma.balance.findMany({
        where: { guildId },
        orderBy: { amount: 'desc' },
        take: req.query.limit,
      });
      return {
        entries: top.map((b, i) => ({
          rank: i + 1,
          guildId,
          userId: b.userId,
          amount: b.amount,
        })),
      };
    },
  );

  app.get(
    '/admin/guilds/:guildId/shop',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const items = await app.prisma.shopItem.findMany({ where: { guildId }, orderBy: { price: 'asc' } });
      return {
        items: items.map((i) => ({
          id: i.id,
          guildId: i.guildId,
          name: i.name,
          description: i.description,
          price: i.price,
          kind: i.kind as 'virtual' | 'role',
          roleId: i.roleId,
          stock: i.stock,
          createdAt: i.createdAt.toISOString(),
        })),
      };
    },
  );

  // ─── Tickets ──────────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/ticket-config',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const cfg = await app.prisma.ticketConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: cfg?.enabled ?? false,
        panelChannelId: cfg?.panelChannelId ?? null,
        panelMessageId: cfg?.panelMessageId ?? null,
        staffRoleId: cfg?.staffRoleId ?? null,
        defaultSlaSeconds: cfg?.defaultSlaSeconds ?? null,
        transcriptChannelId: cfg?.transcriptChannelId ?? null,
      };
    },
  );

  app.put(
    '/admin/guilds/:guildId/ticket-config',
    { schema: { params: Params, body: UpdateTicketConfigSchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const patch = req.body;
      const update: Record<string, unknown> = {};
      for (const k of [
        'enabled',
        'panelChannelId',
        'panelMessageId',
        'staffRoleId',
        'defaultSlaSeconds',
        'transcriptChannelId',
      ] as const) {
        const v = (patch as Record<string, unknown>)[k];
        if (v !== undefined) update[k] = v;
      }
      const cfg = await app.prisma.ticketConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          panelChannelId: patch.panelChannelId ?? null,
          panelMessageId: patch.panelMessageId ?? null,
          staffRoleId: patch.staffRoleId ?? null,
          defaultSlaSeconds: patch.defaultSlaSeconds ?? null,
          transcriptChannelId: patch.transcriptChannelId ?? null,
        },
      });
      return cfg;
    },
  );

  app.get(
    '/admin/guilds/:guildId/ticket-categories',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const cats = await app.prisma.ticketCategory.findMany({
        where: { guildId },
        orderBy: { position: 'asc' },
      });
      return {
        categories: cats.map((c) => ({
          id: c.id,
          guildId: c.guildId,
          name: c.name,
          description: c.description,
          emoji: c.emoji,
          staffRoleId: c.staffRoleId,
          slaSeconds: c.slaSeconds,
          position: c.position,
        })),
      };
    },
  );

  app.get(
    '/admin/guilds/:guildId/tickets',
    {
      schema: {
        params: Params,
        querystring: z.object({
          status: z.enum(['open', 'closed']).optional(),
          userId: SnowflakeSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const items = await app.prisma.ticket.findMany({
        where: {
          guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
          ...(req.query.userId ? { userId: req.query.userId } : {}),
        },
        orderBy: { openedAt: 'desc' },
        take: req.query.limit,
      });
      return {
        tickets: items.map((t) => ({
          id: t.id,
          guildId: t.guildId,
          categoryId: t.categoryId,
          userId: t.userId,
          channelId: t.channelId,
          number: t.number,
          status: t.status as 'open' | 'closed',
          subject: t.subject,
          assignedTo: t.assignedTo,
          openedAt: t.openedAt.toISOString(),
          closedAt: t.closedAt?.toISOString() ?? null,
          closedBy: t.closedBy,
          closeReason: t.closeReason,
        })),
      };
    },
  );

  // ─── Stats ────────────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/stats/mod-actions-trend',
    {
      schema: {
        params: Params,
        querystring: z.object({ days: z.coerce.number().int().min(1).max(180).default(30) }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      return { trend: await modActionsTrend(app.prisma, guildId, req.query.days) };
    },
  );

  app.get(
    '/admin/guilds/:guildId/stats/member-growth',
    {
      schema: {
        params: Params,
        querystring: z.object({ days: z.coerce.number().int().min(1).max(180).default(30) }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      return { trend: await memberGrowth(app.prisma, guildId, req.query.days) };
    },
  );

  app.get(
    '/admin/guilds/:guildId/stats/top-targets',
    {
      schema: {
        params: Params,
        querystring: z.object({
          days: z.coerce.number().int().min(1).max(180).default(30),
          limit: z.coerce.number().int().min(1).max(50).default(10),
        }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      return { top: await topTargets(app.prisma, guildId, req.query.days, req.query.limit) };
    },
  );

  app.get(
    '/admin/guilds/:guildId/stats/channel-heatmap',
    {
      schema: {
        params: Params,
        querystring: z.object({ days: z.coerce.number().int().min(1).max(60).default(7) }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      return { heatmap: await channelHeatmap(app.prisma, guildId, req.query.days) };
    },
  );

  // ─── Admin action audit log ───────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/admin-actions',
    {
      schema: {
        params: Params,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const items = await app.prisma.adminAction.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return {
        actions: items.map((a) => ({
          id: a.id,
          guildId: a.guildId,
          userId: a.userId,
          method: a.method,
          path: a.path,
          summary: a.summary as Record<string, unknown>,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    },
  );

  // ─── Config export ────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/export',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const [welcome, logging, policy, automod, verification, leveling, economy, tickets, ticketCats] =
        await Promise.all([
          app.prisma.welcomeConfig.findUnique({ where: { guildId } }),
          app.prisma.loggingConfig.findUnique({ where: { guildId } }),
          app.prisma.warningPolicy.findUnique({ where: { guildId } }),
          app.prisma.automodConfig.findUnique({ where: { guildId } }),
          app.prisma.verificationConfig.findUnique({ where: { guildId } }),
          app.prisma.levelConfig.findUnique({ where: { guildId } }),
          app.prisma.economyConfig.findUnique({ where: { guildId } }),
          app.prisma.ticketConfig.findUnique({ where: { guildId } }),
          app.prisma.ticketCategory.findMany({ where: { guildId } }),
        ]);
      const [shop, panels, tags, autoResponses] = await Promise.all([
        app.prisma.shopItem.findMany({ where: { guildId } }),
        app.prisma.reactionRolePanel.findMany({ where: { guildId }, include: { options: true } }),
        app.prisma.tag.findMany({ where: { guildId } }),
        app.prisma.autoResponse.findMany({ where: { guildId } }),
      ]);
      return {
        guildId,
        exportedAt: new Date().toISOString(),
        welcome,
        logging,
        warningPolicy: policy,
        automod,
        verification,
        leveling,
        economy,
        tickets: { config: tickets, categories: ticketCats },
        shop,
        reactionRolePanels: panels,
        tags,
        autoResponses,
      };
    },
  );

  // ─── Integrations ─────────────────────────────────────────────────────
  app.get(
    '/admin/guilds/:guildId/integrations',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const subs = await app.prisma.integrationSubscription.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        integrations: subs.map((s) => ({
          id: s.id,
          guildId: s.guildId,
          channelId: s.channelId,
          name: s.name,
          kind: s.kind as 'rss' | 'webhook',
          rssUrl: s.rssUrl,
          lastSeenGuid: s.lastSeenGuid,
          lastPolledAt: s.lastPolledAt?.toISOString() ?? null,
          pollInterval: s.pollInterval,
          token: s.token,
          secret: s.secret,
          enabled: s.enabled,
          createdAt: s.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/admin/guilds/:guildId/integrations',
    {
      schema: {
        params: Params,
        body: z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('rss'),
            name: z.string().min(1).max(80),
            channelId: SnowflakeSchema,
            rssUrl: z.string().url(),
            pollInterval: z.number().int().min(60).max(86_400).optional(),
          }),
          z.object({
            kind: z.literal('webhook'),
            name: z.string().min(1).max(80),
            channelId: SnowflakeSchema,
            secret: z.string().min(8).max(128).optional(),
          }),
        ]),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const { randomBytes } = await import('node:crypto');
      const body = req.body;
      if (body.kind === 'rss') {
        const created = await app.prisma.integrationSubscription.create({
          data: {
            guildId,
            channelId: body.channelId,
            name: body.name,
            kind: 'rss',
            rssUrl: body.rssUrl,
            pollInterval: body.pollInterval ?? 600,
          },
        });
        return { id: created.id };
      }
      const created = await app.prisma.integrationSubscription.create({
        data: {
          guildId,
          channelId: body.channelId,
          name: body.name,
          kind: 'webhook',
          token: randomBytes(24).toString('base64url'),
          secret: body.secret ?? null,
        },
      });
      return { id: created.id, token: created.token };
    },
  );

  app.delete(
    '/admin/guilds/:guildId/integrations/:integrationId',
    {
      schema: {
        params: z.object({ guildId: SnowflakeSchema, integrationId: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { guildId, integrationId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const result = await app.prisma.integrationSubscription.deleteMany({
        where: { id: integrationId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Integration not found.');
      return reply.code(204).send();
    },
  );

  // Note: re-exported schemas keep the type union compile-coupled to the
  // dashboard even though no route uses them directly.
  void ModActionTypeSchema;
};
