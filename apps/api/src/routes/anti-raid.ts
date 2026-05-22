import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  AntiRaidConfig as PrismaAntiRaidConfig,
  LockdownEvent as PrismaLockdownEvent,
  PendingVerification as PrismaPendingVerification,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreatePendingVerificationSchema,
  SnowflakeSchema,
  StartLockdownSchema,
  UpsertAntiRaidConfigSchema,
  VerifyChallengeSchema,
  type CaptchaKind,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const LockdownParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });
const PendingUserParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function serializeConfig(guildId: string, cfg: PrismaAntiRaidConfig | null) {
  return {
    guildId,
    enabled: cfg?.enabled ?? false,
    joinsPerMinuteThreshold: cfg?.joinsPerMinuteThreshold ?? 8,
    lockdownDurationMin: cfg?.lockdownDurationMin ?? 30,
    captchaRequired: cfg?.captchaRequired ?? false,
    captchaKind: (cfg?.captchaKind ?? 'math') as CaptchaKind,
    riskScoreThreshold: cfg?.riskScoreThreshold ?? 50,
    unverifiedRoleId: cfg?.unverifiedRoleId ?? null,
  };
}

function serializeLockdown(ev: PrismaLockdownEvent) {
  return {
    id: ev.id,
    guildId: ev.guildId,
    startedAt: ev.startedAt.toISOString(),
    endedAt: ev.endedAt?.toISOString() ?? null,
    trigger: ev.trigger,
    joinsBlocked: ev.joinsBlocked,
  };
}

function serializePending(p: PrismaPendingVerification) {
  return {
    guildId: p.guildId,
    userId: p.userId,
    challengeKind: p.challengeKind as CaptchaKind,
    challenge: p.challenge,
    answer: p.answer,
    attemptsLeft: p.attemptsLeft,
    expiresAt: p.expiresAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
  };
}

export const antiRaidRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Config ─────────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/anti-raid-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.antiRaidConfig.findUnique({ where: { guildId } });
      return serializeConfig(guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/anti-raid-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertAntiRaidConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;

      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.joinsPerMinuteThreshold !== undefined)
        update.joinsPerMinuteThreshold = patch.joinsPerMinuteThreshold;
      if (patch.lockdownDurationMin !== undefined)
        update.lockdownDurationMin = patch.lockdownDurationMin;
      if (patch.captchaRequired !== undefined) update.captchaRequired = patch.captchaRequired;
      if (patch.captchaKind !== undefined) update.captchaKind = patch.captchaKind;
      if (patch.riskScoreThreshold !== undefined)
        update.riskScoreThreshold = patch.riskScoreThreshold;
      if (patch.unverifiedRoleId !== undefined) update.unverifiedRoleId = patch.unverifiedRoleId;

      const cfg = await app.prisma.antiRaidConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          joinsPerMinuteThreshold: patch.joinsPerMinuteThreshold ?? 8,
          lockdownDurationMin: patch.lockdownDurationMin ?? 30,
          captchaRequired: patch.captchaRequired ?? false,
          captchaKind: patch.captchaKind ?? 'math',
          riskScoreThreshold: patch.riskScoreThreshold ?? 50,
          unverifiedRoleId: patch.unverifiedRoleId ?? null,
        },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  // ── Lockdown events ────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/lockdown-events',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, querystring: ListQuery },
    },
    async (req) => {
      const events = await app.prisma.lockdownEvent.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { startedAt: 'desc' },
        take: req.query.limit,
      });
      return { events: events.map(serializeLockdown) };
    },
  );

  app.post(
    '/guilds/:guildId/lockdown/start',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: StartLockdownSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      // Cap one active lockdown at a time — if an active row exists, return it.
      const active = await app.prisma.lockdownEvent.findFirst({
        where: { guildId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (active) return serializeLockdown(active);

      const event = await app.prisma.lockdownEvent.create({
        data: { guildId, trigger: req.body.trigger },
      });
      return serializeLockdown(event);
    },
  );

  app.post(
    '/guilds/:guildId/lockdown/:id/end',
    {
      preHandler: app.requireBot(),
      schema: {
        params: LockdownParams,
        body: z.object({ joinsBlocked: z.number().int().nonnegative().optional() }).optional(),
      },
    },
    async (req) => {
      const data: { endedAt: Date; joinsBlocked?: number } = { endedAt: new Date() };
      if (req.body?.joinsBlocked !== undefined) data.joinsBlocked = req.body.joinsBlocked;
      const ev = await app.prisma.lockdownEvent.update({
        where: { id: req.params.id },
        data,
      });
      return serializeLockdown(ev);
    },
  );

  // ── Pending verifications ──────────────────────────────────────────────
  app.post(
    '/guilds/:guildId/pending-verifications',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreatePendingVerificationSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const expiresAt = new Date(req.body.expiresAt);
      const pending = await app.prisma.pendingVerification.upsert({
        where: { guildId_userId: { guildId, userId: req.body.userId } },
        update: {
          challengeKind: req.body.challengeKind,
          challenge: req.body.challenge,
          answer: req.body.answer.toLowerCase(),
          attemptsLeft: req.body.attemptsLeft ?? 3,
          expiresAt,
        },
        create: {
          guildId,
          userId: req.body.userId,
          challengeKind: req.body.challengeKind,
          challenge: req.body.challenge,
          answer: req.body.answer.toLowerCase(),
          attemptsLeft: req.body.attemptsLeft ?? 3,
          expiresAt,
        },
      });
      return serializePending(pending);
    },
  );

  app.get(
    '/guilds/:guildId/pending-verifications/:userId',
    { preHandler: app.requireBot(), schema: { params: PendingUserParams } },
    async (req) => {
      const pending = await app.prisma.pendingVerification.findUnique({
        where: {
          guildId_userId: { guildId: req.params.guildId, userId: req.params.userId },
        },
      });
      if (!pending) throw HttpError.notFound('No pending verification.');
      return serializePending(pending);
    },
  );

  app.get('/pending-verifications/expired', { preHandler: app.requireBot() }, async () => {
    const expired = await app.prisma.pendingVerification.findMany({
      where: { expiresAt: { lte: new Date() } },
      take: 100,
    });
    return { pending: expired.map(serializePending) };
  });

  app.delete(
    '/guilds/:guildId/pending-verifications/:userId',
    { preHandler: app.requireBot(), schema: { params: PendingUserParams } },
    async (req, reply) => {
      await app.prisma.pendingVerification
        .delete({
          where: {
            guildId_userId: { guildId: req.params.guildId, userId: req.params.userId },
          },
        })
        .catch(() => {});
      return reply.code(204).send();
    },
  );

  app.post(
    '/guilds/:guildId/pending-verifications/:userId/verify',
    {
      preHandler: app.requireBot(),
      schema: { params: PendingUserParams, body: VerifyChallengeSchema },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const pending = await app.prisma.pendingVerification.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      if (!pending) {
        return { ok: false, attemptsLeft: 0, expired: false, notFound: true };
      }
      if (pending.expiresAt.getTime() <= Date.now()) {
        await app.prisma.pendingVerification
          .delete({ where: { guildId_userId: { guildId, userId } } })
          .catch(() => {});
        return { ok: false, attemptsLeft: 0, expired: true, notFound: false };
      }

      const submitted = req.body.answer.trim().toLowerCase();
      if (submitted === pending.answer) {
        await app.prisma.pendingVerification
          .delete({ where: { guildId_userId: { guildId, userId } } })
          .catch(() => {});
        return { ok: true, attemptsLeft: pending.attemptsLeft, expired: false, notFound: false };
      }

      const nextAttempts = pending.attemptsLeft - 1;
      if (nextAttempts <= 0) {
        await app.prisma.pendingVerification
          .delete({ where: { guildId_userId: { guildId, userId } } })
          .catch(() => {});
        return { ok: false, attemptsLeft: 0, expired: false, notFound: false };
      }
      await app.prisma.pendingVerification.update({
        where: { guildId_userId: { guildId, userId } },
        data: { attemptsLeft: nextAttempts },
      });
      return { ok: false, attemptsLeft: nextAttempts, expired: false, notFound: false };
    },
  );
};
