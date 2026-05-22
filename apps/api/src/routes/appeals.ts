import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  Appeal as PrismaAppeal,
  AppealSlaConfig as PrismaAppealSlaConfig,
  WarningLadderStep as PrismaWarningLadderStep,
} from '@prisma/client';
import { z } from 'zod';
import {
  AppealStatusSchema,
  CreateAppealSchema,
  ReviewAppealSchema,
  SnowflakeSchema,
  UpsertAppealSlaConfigSchema,
  UpsertLadderStepSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const StepParams = z.object({ guildId: SnowflakeSchema, stepId: z.string().uuid() });
const AppealParams = z.object({ guildId: SnowflakeSchema, appealId: z.string().uuid() });

function serializeLadderStep(s: PrismaWarningLadderStep) {
  return {
    id: s.id,
    guildId: s.guildId,
    threshold: s.threshold,
    action: s.action as 'mute' | 'kick' | 'ban',
    durationMinutes: s.durationMinutes,
  };
}

function serializeAppeal(a: PrismaAppeal) {
  return {
    id: a.id,
    guildId: a.guildId,
    userId: a.userId,
    modActionId: a.modActionId,
    message: a.message,
    status: a.status as 'open' | 'approved' | 'denied',
    reviewNote: a.reviewNote,
    reviewedBy: a.reviewedBy,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

function serializeSla(c: PrismaAppealSlaConfig) {
  return {
    guildId: c.guildId,
    warnHours: c.warnHours,
    escalateChannelId: c.escalateChannelId,
  };
}

export const appealsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Warning ladder CRUD ─────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/warn-ladder',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.warningLadderStep.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { threshold: 'asc' },
      });
      return { steps: items.map(serializeLadderStep) };
    },
  );

  app.post(
    '/guilds/:guildId/warn-ladder',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertLadderStepSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const step = await app.prisma.warningLadderStep.upsert({
        where: { guildId_threshold: { guildId, threshold: req.body.threshold } },
        update: {
          action: req.body.action,
          durationMinutes: req.body.durationMinutes ?? null,
        },
        create: {
          guildId,
          threshold: req.body.threshold,
          action: req.body.action,
          durationMinutes: req.body.durationMinutes ?? null,
        },
      });
      return serializeLadderStep(step);
    },
  );

  app.delete(
    '/guilds/:guildId/warn-ladder/:stepId',
    { preHandler: app.requireBot(), schema: { params: StepParams } },
    async (req, reply) => {
      const result = await app.prisma.warningLadderStep.deleteMany({
        where: { id: req.params.stepId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Step not found.');
      return reply.code(204).send();
    },
  );

  // Convenience: delete by threshold (used by /warn-ladder remove).
  app.delete(
    '/guilds/:guildId/warn-ladder/by-threshold/:threshold',
    {
      preHandler: app.requireBot(),
      schema: {
        params: z.object({
          guildId: SnowflakeSchema,
          threshold: z.coerce.number().int().positive(),
        }),
      },
    },
    async (req, reply) => {
      const result = await app.prisma.warningLadderStep.deleteMany({
        where: { guildId: req.params.guildId, threshold: req.params.threshold },
      });
      if (result.count === 0) throw HttpError.notFound('Step not found.');
      return reply.code(204).send();
    },
  );

  // ─── Appeals ─────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/appeals',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          status: AppealStatusSchema.optional(),
          userId: SnowflakeSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const items = await app.prisma.appeal.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
          ...(req.query.userId ? { userId: req.query.userId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { appeals: items.map(serializeAppeal) };
    },
  );

  app.get(
    '/guilds/:guildId/appeals/:appealId',
    { preHandler: app.requireBot(), schema: { params: AppealParams } },
    async (req) => {
      const item = await app.prisma.appeal.findFirst({
        where: { id: req.params.appealId, guildId: req.params.guildId },
      });
      if (!item) throw HttpError.notFound('Appeal not found.');
      return serializeAppeal(item);
    },
  );

  app.post(
    '/guilds/:guildId/appeals',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateAppealSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      // If a mod-action id is supplied, validate it belongs to this guild and user.
      if (req.body.modActionId) {
        const action = await app.prisma.modAction.findFirst({
          where: { id: req.body.modActionId, guildId, userId: req.body.userId },
        });
        if (!action) throw HttpError.notFound('Mod action not found for this user.');
      }

      const created = await app.prisma.appeal.create({
        data: {
          guildId,
          userId: req.body.userId,
          message: req.body.message,
          modActionId: req.body.modActionId ?? null,
        },
      });
      return serializeAppeal(created);
    },
  );

  app.post(
    '/guilds/:guildId/appeals/:appealId/review',
    {
      preHandler: app.requireBot(),
      schema: { params: AppealParams, body: ReviewAppealSchema },
    },
    async (req) => {
      const existing = await app.prisma.appeal.findFirst({
        where: { id: req.params.appealId, guildId: req.params.guildId },
      });
      if (!existing) throw HttpError.notFound('Appeal not found.');
      if (existing.status !== 'open') {
        throw HttpError.conflict('Appeal already reviewed.');
      }
      const updated = await app.prisma.appeal.update({
        where: { id: req.params.appealId },
        data: {
          status: req.body.status,
          reviewedBy: req.body.reviewedBy,
          reviewNote: req.body.reviewNote ?? null,
          reviewedAt: new Date(),
        },
      });
      return serializeAppeal(updated);
    },
  );

  // ─── Appeal SLA config ───────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/appeal-sla',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const cfg = await app.prisma.appealSlaConfig.findUnique({
        where: { guildId: req.params.guildId },
      });
      if (!cfg) {
        return {
          guildId: req.params.guildId,
          warnHours: 24,
          escalateChannelId: null,
        };
      }
      return serializeSla(cfg);
    },
  );

  app.put(
    '/guilds/:guildId/appeal-sla',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertAppealSlaConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const update: { warnHours?: number; escalateChannelId?: string | null } = {};
      if (req.body.warnHours !== undefined) update.warnHours = req.body.warnHours;
      if (req.body.escalateChannelId !== undefined) update.escalateChannelId = req.body.escalateChannelId;
      const cfg = await app.prisma.appealSlaConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          warnHours: req.body.warnHours ?? 24,
          escalateChannelId: req.body.escalateChannelId ?? null,
        },
      });
      return serializeSla(cfg);
    },
  );

  // ─── Stale appeal sweep (used by the bot scheduler) ──────────────────
  // Returns open appeals older than the configured warnHours where the
  // guild has an escalate channel configured.
  app.get(
    '/appeals/stale',
    {
      preHandler: app.requireBot(),
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const configs = await app.prisma.appealSlaConfig.findMany({
        where: { escalateChannelId: { not: null } },
      });
      const out: Array<ReturnType<typeof serializeAppeal> & { escalateChannelId: string }> = [];
      const now = Date.now();
      for (const cfg of configs) {
        if (!cfg.escalateChannelId) continue;
        const cutoff = new Date(now - cfg.warnHours * 3_600_000);
        const stale = await app.prisma.appeal.findMany({
          where: {
            guildId: cfg.guildId,
            status: 'open',
            createdAt: { lt: cutoff },
          },
          orderBy: { createdAt: 'asc' },
          take: req.query.limit,
        });
        for (const a of stale) {
          out.push({ ...serializeAppeal(a), escalateChannelId: cfg.escalateChannelId });
          if (out.length >= req.query.limit) break;
        }
        if (out.length >= req.query.limit) break;
      }
      return { appeals: out };
    },
  );

  // Ladder lookup (used by the bot warn flow to compute escalation). Returns
  // the highest step whose threshold ≤ activeWarnings (or null).
  app.get(
    '/guilds/:guildId/warn-ladder/triggered',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({ activeWarnings: z.coerce.number().int().nonnegative() }),
      },
    },
    async (req) => {
      const step = await app.prisma.warningLadderStep.findFirst({
        where: {
          guildId: req.params.guildId,
          threshold: { lte: req.query.activeWarnings },
        },
        orderBy: { threshold: 'desc' },
      });
      return { step: step ? serializeLadderStep(step) : null };
    },
  );
};
