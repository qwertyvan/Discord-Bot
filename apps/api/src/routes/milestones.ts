import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  MilestoneConfig as PrismaMilestoneConfig,
  TenureRoleRule as PrismaTenureRoleRule,
  MilestoneAward as PrismaMilestoneAward,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateMilestoneAwardSchema,
  MilestoneAwardKindSchema,
  SnowflakeSchema,
  UpsertMilestoneConfigSchema,
  UpsertTenureRoleRuleSchema,
  type MilestoneAwardKind,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const TenureParams = z.object({ guildId: SnowflakeSchema, ruleId: z.string().uuid() });

function serializeConfig(
  guildId: string,
  cfg: PrismaMilestoneConfig | null,
): {
  guildId: string;
  joinaversaryChannelId: string | null;
  joinaversaryTemplate: string | null;
  joinaversaryReward: number;
  boostChannelId: string | null;
  boostRoleId: string | null;
  boostReward: number;
  enabled: boolean;
} {
  return {
    guildId,
    joinaversaryChannelId: cfg?.joinaversaryChannelId ?? null,
    joinaversaryTemplate: cfg?.joinaversaryTemplate ?? null,
    joinaversaryReward: cfg?.joinaversaryReward ?? 0,
    boostChannelId: cfg?.boostChannelId ?? null,
    boostRoleId: cfg?.boostRoleId ?? null,
    boostReward: cfg?.boostReward ?? 0,
    enabled: cfg?.enabled ?? false,
  };
}

function serializeRule(r: PrismaTenureRoleRule) {
  return {
    id: r.id,
    guildId: r.guildId,
    roleId: r.roleId,
    daysRequired: r.daysRequired,
    createdAt: r.createdAt.toISOString(),
  };
}

function serializeAward(a: PrismaMilestoneAward) {
  return {
    id: a.id,
    guildId: a.guildId,
    userId: a.userId,
    kind: a.kind as MilestoneAwardKind,
    payload: (a.payload as Record<string, unknown> | null) ?? null,
    awardedAt: a.awardedAt.toISOString(),
  };
}

export const milestonesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── MilestoneConfig (bot-bearer) ────────────────────────────────────
  app.get(
    '/guilds/:guildId/milestone-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const cfg = await app.prisma.milestoneConfig.findUnique({
        where: { guildId: req.params.guildId },
      });
      return serializeConfig(req.params.guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/milestone-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertMilestoneConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.joinaversaryChannelId !== undefined)
        update.joinaversaryChannelId = patch.joinaversaryChannelId;
      if (patch.joinaversaryTemplate !== undefined)
        update.joinaversaryTemplate = patch.joinaversaryTemplate;
      if (patch.joinaversaryReward !== undefined)
        update.joinaversaryReward = patch.joinaversaryReward;
      if (patch.boostChannelId !== undefined) update.boostChannelId = patch.boostChannelId;
      if (patch.boostRoleId !== undefined) update.boostRoleId = patch.boostRoleId;
      if (patch.boostReward !== undefined) update.boostReward = patch.boostReward;
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      const cfg = await app.prisma.milestoneConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          joinaversaryChannelId: patch.joinaversaryChannelId ?? null,
          joinaversaryTemplate: patch.joinaversaryTemplate ?? null,
          joinaversaryReward: patch.joinaversaryReward ?? 0,
          boostChannelId: patch.boostChannelId ?? null,
          boostRoleId: patch.boostRoleId ?? null,
          boostReward: patch.boostReward ?? 0,
          enabled: patch.enabled ?? false,
        },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  // ─── TenureRoleRule CRUD (bot-bearer) ────────────────────────────────
  app.get(
    '/guilds/:guildId/tenure-roles',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const rules = await app.prisma.tenureRoleRule.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { daysRequired: 'asc' },
      });
      return { rules: rules.map(serializeRule) };
    },
  );

  app.post(
    '/guilds/:guildId/tenure-roles',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertTenureRoleRuleSchema },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const rule = await app.prisma.tenureRoleRule.upsert({
        where: { guildId_roleId: { guildId, roleId: req.body.roleId } },
        update: { daysRequired: req.body.daysRequired },
        create: {
          guildId,
          roleId: req.body.roleId,
          daysRequired: req.body.daysRequired,
        },
      });
      reply.code(201);
      return serializeRule(rule);
    },
  );

  app.patch(
    '/guilds/:guildId/tenure-roles/:ruleId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: TenureParams,
        body: z.object({
          roleId: SnowflakeSchema.optional(),
          daysRequired: z.number().int().min(1).max(36_500).optional(),
        }),
      },
    },
    async (req) => {
      const { guildId, ruleId } = req.params;
      const existing = await app.prisma.tenureRoleRule.findFirst({
        where: { id: ruleId, guildId },
      });
      if (!existing) throw HttpError.notFound('Rule not found.');
      const update: Record<string, unknown> = {};
      if (req.body.roleId !== undefined) update.roleId = req.body.roleId;
      if (req.body.daysRequired !== undefined) update.daysRequired = req.body.daysRequired;
      const rule = await app.prisma.tenureRoleRule.update({
        where: { id: ruleId },
        data: update,
      });
      return serializeRule(rule);
    },
  );

  app.delete(
    '/guilds/:guildId/tenure-roles/:ruleId',
    { preHandler: app.requireBot(), schema: { params: TenureParams } },
    async (req, reply) => {
      const { guildId, ruleId } = req.params;
      const result = await app.prisma.tenureRoleRule.deleteMany({
        where: { id: ruleId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Rule not found.');
      return reply.code(204).send();
    },
  );

  // Convenience: delete by roleId so the slash command doesn't need to pre-fetch.
  app.delete(
    '/guilds/:guildId/tenure-roles/by-role/:roleId',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ guildId: SnowflakeSchema, roleId: SnowflakeSchema }) },
    },
    async (req, reply) => {
      const result = await app.prisma.tenureRoleRule.deleteMany({
        where: { guildId: req.params.guildId, roleId: req.params.roleId },
      });
      if (result.count === 0) throw HttpError.notFound('Rule not found.');
      return reply.code(204).send();
    },
  );

  // ─── MilestoneAward ledger (bot-bearer) ──────────────────────────────
  app.post(
    '/guilds/:guildId/milestone-awards',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateMilestoneAwardSchema },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const award = await app.prisma.milestoneAward.create({
        data: {
          guildId,
          userId: req.body.userId,
          kind: req.body.kind,
          ...(req.body.payload !== undefined
            ? { payload: req.body.payload as Prisma.InputJsonValue }
            : {}),
        },
      });
      reply.code(201);
      return serializeAward(award);
    },
  );

  app.get(
    '/guilds/:guildId/milestone-awards',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          userId: SnowflakeSchema.optional(),
          kind: MilestoneAwardKindSchema.optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
      },
    },
    async (req) => {
      const where: Record<string, unknown> = { guildId: req.params.guildId };
      if (req.query.userId) where.userId = req.query.userId;
      if (req.query.kind) where.kind = req.query.kind;
      const rows = await app.prisma.milestoneAward.findMany({
        where,
        orderBy: { awardedAt: 'desc' },
        take: req.query.limit,
      });
      return { awards: rows.map(serializeAward) };
    },
  );

  // ─── Enabled milestone configs (bot-bearer) ──────────────────────────
  // Used by the scheduler's daily sweep to find guilds that need a tick.
  app.get(
    '/milestone-configs/enabled',
    { preHandler: app.requireBot() },
    async () => {
      const configs = await app.prisma.milestoneConfig.findMany({
        where: { enabled: true },
      });
      return {
        configs: configs.map((c) => serializeConfig(c.guildId, c)),
      };
    },
  );
};
