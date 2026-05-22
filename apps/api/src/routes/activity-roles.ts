import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type {
  ActivityRoleRule as PrismaActivityRoleRule,
  InactivityPrunePolicy as PrismaInactivityPrunePolicy,
  MemberActivity as PrismaMemberActivity,
} from '@prisma/client';
import { z } from 'zod';
import {
  ActivityRoleActionSchema,
  MemberActivityBatchSchema,
  SnowflakeSchema,
  UpsertActivityRoleRuleSchema,
  UpsertPolicySchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { DiscordAuthError } from '../discord.js';
import { decryptTokenOrPlaintext } from '../crypto.js';
import { getManageableGuilds, invalidatePermissionsCache } from '../guild-permissions.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const RuleParams = z.object({ guildId: SnowflakeSchema, ruleId: z.string().uuid() });

function serializeRule(r: PrismaActivityRoleRule) {
  return {
    id: r.id,
    guildId: r.guildId,
    roleId: r.roleId,
    minMessages: r.minMessages,
    minVoiceMinutes: r.minVoiceMinutes,
    windowDays: r.windowDays,
    action: r.action as 'grant' | 'revoke',
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  };
}

function serializePolicy(guildId: string, p: PrismaInactivityPrunePolicy | null) {
  return {
    guildId,
    enabled: p?.enabled ?? false,
    inactiveDays: p?.inactiveDays ?? 60,
    excludeRoleIds: p?.excludeRoleIds ?? [],
    notifyDm: p?.notifyDm ?? true,
  };
}

function serializeActivity(a: PrismaMemberActivity) {
  return {
    guildId: a.guildId,
    userId: a.userId,
    messages: a.messages,
    voiceMinutes: a.voiceMinutes,
    lastActiveAt: a.lastActiveAt.toISOString(),
  };
}

// Used by the dashboard-facing prune endpoints. Mirrors the helper used in
// admin/reaction-roles.ts so we re-verify Manage-Server on every request and
// invalidate the session if Discord rejects the cached OAuth token.
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
  try {
    const manageable = await getManageableGuilds(
      dbUser.discordId,
      decryptTokenOrPlaintext(dbUser.accessToken, app.config.TOKEN_ENCRYPTION_KEY),
    );
    if (!manageable.some((g) => g.id === guildId)) {
      throw HttpError.forbidden('You do not have Manage Server on this guild.');
    }
  } catch (err) {
    if (err instanceof DiscordAuthError && req.user) {
      await app.prisma.session.delete({ where: { id: req.user.sessionId } }).catch(() => {});
      invalidatePermissionsCache(req.user.userId);
      app.clearSession(reply);
      throw HttpError.unauthorized('Discord session expired. Please sign in again.');
    }
    throw err;
  }
  const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) throw HttpError.notFound('Bot is not in that guild.');
}

export const activityRolesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Activity-role rules (CRUD, bot-bearer) ──────────────────────────
  // The bot reads these in its daily scheduler. They are also editable via
  // slash commands which proxy through the same bot-bearer path.
  app.get(
    '/guilds/:guildId/activity-rules',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const rules = await app.prisma.activityRoleRule.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'asc' },
      });
      return { rules: rules.map(serializeRule) };
    },
  );

  app.post(
    '/guilds/:guildId/activity-rules',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertActivityRoleRuleSchema },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const rule = await app.prisma.activityRoleRule.create({
        data: {
          guildId,
          roleId: req.body.roleId,
          minMessages: req.body.minMessages ?? 0,
          minVoiceMinutes: req.body.minVoiceMinutes ?? 0,
          windowDays: req.body.windowDays ?? 30,
          action: req.body.action ?? 'grant',
          enabled: req.body.enabled ?? true,
        },
      });
      reply.code(201);
      return serializeRule(rule);
    },
  );

  app.patch(
    '/guilds/:guildId/activity-rules/:ruleId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: RuleParams,
        body: z.object({
          roleId: SnowflakeSchema.optional(),
          minMessages: z.number().int().nonnegative().optional(),
          minVoiceMinutes: z.number().int().nonnegative().optional(),
          windowDays: z.number().int().min(1).max(365).optional(),
          action: ActivityRoleActionSchema.optional(),
          enabled: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const { guildId, ruleId } = req.params;
      const existing = await app.prisma.activityRoleRule.findFirst({
        where: { id: ruleId, guildId },
      });
      if (!existing) throw HttpError.notFound('Rule not found.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.roleId !== undefined) update.roleId = patch.roleId;
      if (patch.minMessages !== undefined) update.minMessages = patch.minMessages;
      if (patch.minVoiceMinutes !== undefined) update.minVoiceMinutes = patch.minVoiceMinutes;
      if (patch.windowDays !== undefined) update.windowDays = patch.windowDays;
      if (patch.action !== undefined) update.action = patch.action;
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      const rule = await app.prisma.activityRoleRule.update({
        where: { id: ruleId },
        data: update,
      });
      return serializeRule(rule);
    },
  );

  app.delete(
    '/guilds/:guildId/activity-rules/:ruleId',
    { preHandler: app.requireBot(), schema: { params: RuleParams } },
    async (req, reply) => {
      const { guildId, ruleId } = req.params;
      const result = await app.prisma.activityRoleRule.deleteMany({
        where: { id: ruleId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Rule not found.');
      return reply.code(204).send();
    },
  );

  // ─── Inactivity prune policy (bot-bearer) ────────────────────────────
  app.get(
    '/guilds/:guildId/prune-policy',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const policy = await app.prisma.inactivityPrunePolicy.findUnique({
        where: { guildId: req.params.guildId },
      });
      return serializePolicy(req.params.guildId, policy);
    },
  );

  app.put(
    '/guilds/:guildId/prune-policy',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertPolicySchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.inactiveDays !== undefined) update.inactiveDays = patch.inactiveDays;
      if (patch.excludeRoleIds !== undefined) update.excludeRoleIds = patch.excludeRoleIds;
      if (patch.notifyDm !== undefined) update.notifyDm = patch.notifyDm;
      const policy = await app.prisma.inactivityPrunePolicy.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          inactiveDays: patch.inactiveDays ?? 60,
          excludeRoleIds: patch.excludeRoleIds ?? [],
          notifyDm: patch.notifyDm ?? true,
        },
      });
      return serializePolicy(guildId, policy);
    },
  );

  // ─── Prune preview/execute (session) ─────────────────────────────────
  // These are dashboard-facing; the bot performs its own preview locally
  // for `/prune preview` and `/prune run` slash commands. The endpoints
  // here return the set of candidates from the database — the dashboard
  // surfaces the list and any actual kicks must be performed by the bot
  // via a separate channel.
  async function listPruneCandidates(
    guildId: string,
  ): Promise<{
    policy: ReturnType<typeof serializePolicy>;
    candidates: Array<{ userId: string; lastActiveAt: string | null }>;
  }> {
    const policy = await app.prisma.inactivityPrunePolicy.findUnique({
      where: { guildId },
    });
    const view = serializePolicy(guildId, policy);
    const cutoff = new Date(Date.now() - view.inactiveDays * 86_400_000);
    const rows = await app.prisma.memberActivity.findMany({
      where: { guildId, lastActiveAt: { lt: cutoff } },
      orderBy: { lastActiveAt: 'asc' },
      take: 1000,
    });
    return {
      policy: view,
      candidates: rows.map((r) => ({
        userId: r.userId,
        lastActiveAt: r.lastActiveAt.toISOString(),
      })),
    };
  }

  app.post(
    '/guilds/:guildId/prune/preview',
    { preHandler: app.requireSession(), schema: { params: GuildParams } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      return listPruneCandidates(guildId);
    },
  );

  app.post(
    '/guilds/:guildId/prune/execute',
    { preHandler: app.requireSession(), schema: { params: GuildParams } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      // The API can't reach the gateway to actually kick — return the set
      // of candidates the operator confirmed. The bot's `/prune run`
      // command is the authoritative executor for kicks.
      return listPruneCandidates(guildId);
    },
  );

  // ─── Member-activity bulk upsert (bot-bearer) ────────────────────────
  // The bot flushes deltas every ~60s. `messages`/`voiceMinutes` are
  // increments; `touch:true` updates lastActiveAt without changing the
  // counters.
  app.post(
    '/guilds/:guildId/member-activity/batch',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: MemberActivityBatchSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const now = new Date();
      let applied = 0;
      // Sequential upserts keep the transaction small; batches are capped
      // at 500 entries by the schema validator.
      for (const entry of req.body.entries) {
        const messages = entry.messages ?? 0;
        const voiceMinutes = entry.voiceMinutes ?? 0;
        const shouldTouch =
          entry.touch === true || messages > 0 || voiceMinutes > 0;
        await app.prisma.memberActivity.upsert({
          where: { guildId_userId: { guildId, userId: entry.userId } },
          update: {
            ...(messages > 0 ? { messages: { increment: messages } } : {}),
            ...(voiceMinutes > 0 ? { voiceMinutes: { increment: voiceMinutes } } : {}),
            ...(shouldTouch ? { lastActiveAt: now } : {}),
          },
          create: {
            guildId,
            userId: entry.userId,
            messages,
            voiceMinutes,
            lastActiveAt: now,
          },
        });
        applied++;
      }
      return { ok: true, count: applied };
    },
  );

  // ─── Member-activity readback (bot-bearer) ───────────────────────────
  // The bot's daily scheduler uses this to evaluate activity rules and
  // identify prune candidates without paging the DB itself.
  app.get(
    '/guilds/:guildId/member-activity',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          sinceDays: z.coerce.number().int().min(1).max(365).optional(),
          limit: z.coerce.number().int().min(1).max(5000).default(2000),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const where: Record<string, unknown> = { guildId };
      if (req.query.sinceDays !== undefined) {
        const cutoff = new Date(Date.now() - req.query.sinceDays * 86_400_000);
        where.lastActiveAt = { gte: cutoff };
      }
      const rows = await app.prisma.memberActivity.findMany({
        where,
        orderBy: { lastActiveAt: 'desc' },
        take: req.query.limit,
      });
      return { members: rows.map(serializeActivity) };
    },
  );
};
