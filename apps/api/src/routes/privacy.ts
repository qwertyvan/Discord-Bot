import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ConfirmDeleteSchema,
  RequestDataDeleteSchema,
  RequestDataExportSchema,
  SnowflakeSchema,
  UpsertRetentionPolicySchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { collectUserData, deleteUserData } from '../util/user-data.js';
import { DiscordAuthError } from '../discord.js';
import { decryptTokenOrPlaintext } from '../crypto.js';
import {
  getManageableGuilds,
  invalidatePermissionsCache,
} from '../guild-permissions.js';

const GuildParams = z.object({ gid: SnowflakeSchema });

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

async function ensureManageGuild(
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
    getManageableGuilds(
      dbUser.discordId,
      decryptTokenOrPlaintext(dbUser.accessToken, app.config.TOKEN_ENCRYPTION_KEY),
    ),
  );
  if (!manageable.some((g) => g.id === guildId)) {
    throw HttpError.forbidden('You do not have Manage Server on this guild.');
  }
  const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) throw HttpError.notFound('Bot is not in that guild.');
}

export const privacyRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── /me/data-export ─────────────────────────────────────────────────
  // Bot-authenticated: the bot proxies the user's /data-export slash command.
  // Synchronously collects user data and returns the JSON payload inline,
  // plus a record of the job so the user can see prior requests.
  app.post(
    '/me/data-export',
    { preHandler: app.requireBot(), schema: { body: RequestDataExportSchema } },
    async (req) => {
      const { userId } = req.body;
      const guildId = req.body.guildId;

      const job = await app.prisma.dataExportJob.create({
        data: {
          userId,
          guildId: guildId ?? null,
          status: 'pending',
        },
      });

      try {
        const payload = await collectUserData(app.prisma, userId, guildId);
        await app.prisma.dataExportJob.update({
          where: { id: job.id },
          data: { status: 'completed', completedAt: new Date() },
        });
        return {
          jobId: job.id,
          status: 'completed' as const,
          payload,
        };
      } catch (err) {
        await app.prisma.dataExportJob
          .update({
            where: { id: job.id },
            data: { status: 'failed', completedAt: new Date() },
          })
          .catch(() => {});
        req.log.error({ err }, 'data-export collection failed');
        throw HttpError.badRequest('Failed to assemble export.');
      }
    },
  );

  // ─── /me/data-delete ─────────────────────────────────────────────────
  // Creates a pending request and returns a confirmation token. The bot
  // DMs the token to the user; they must re-run /data-delete-confirm.
  app.post(
    '/me/data-delete',
    { preHandler: app.requireBot(), schema: { body: RequestDataDeleteSchema } },
    async (req) => {
      const { userId } = req.body;
      const guildId = req.body.guildId;
      const token = randomBytes(24).toString('base64url'); // 32 chars

      const request = await app.prisma.dataDeleteRequest.create({
        data: {
          userId,
          guildId: guildId ?? null,
          confirmationToken: token,
          status: 'pending',
        },
      });

      return {
        id: request.id,
        token,
        requestedAt: request.requestedAt.toISOString(),
        guildId: request.guildId,
      };
    },
  );

  // ─── /me/data-delete/confirm ────────────────────────────────────────
  // Validates the token AND the userId (defence in depth — bot already
  // signs requests, but tokens are deliberately re-bound to the requester).
  app.post(
    '/me/data-delete/confirm',
    { preHandler: app.requireBot(), schema: { body: ConfirmDeleteSchema } },
    async (req) => {
      const { token, userId } = req.body;
      const request = await app.prisma.dataDeleteRequest.findFirst({
        where: { confirmationToken: token, status: 'pending' },
      });
      if (!request) throw HttpError.notFound('Token not found or already used.');
      if (request.userId !== userId) {
        throw HttpError.forbidden('Token does not belong to this user.');
      }

      const counts = await deleteUserData(
        app.prisma,
        request.userId,
        request.guildId ?? undefined,
      );

      await app.prisma.dataDeleteRequest.update({
        where: { id: request.id },
        data: {
          status: 'completed',
          confirmedAt: new Date(),
          completedAt: new Date(),
        },
      });

      return {
        id: request.id,
        status: 'completed' as const,
        deleted: counts,
      };
    },
  );

  // ─── Retention policy (bot read) ────────────────────────────────────
  // Bot calls this on its daily prune tick to enumerate per-guild horizons.
  app.get(
    '/guilds/:gid/retention-policy',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const policy = await app.prisma.retentionPolicy.findUnique({
        where: { guildId: req.params.gid },
      });
      return {
        guildId: req.params.gid,
        modActionsDays: policy?.modActionsDays ?? null,
        modLogsDays: policy?.modLogsDays ?? null,
        transcriptDays: policy?.transcriptDays ?? null,
        snapshotDays: policy?.snapshotDays ?? null,
        auditLogDays: policy?.auditLogDays ?? null,
        redactPii: policy?.redactPii ?? false,
      };
    },
  );

  // ─── Retention policy (bot upsert via slash command) ─────────────────
  app.put(
    '/guilds/:gid/retention-policy',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertRetentionPolicySchema },
    },
    async (req) => {
      const guildId = req.params.gid;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.modActionsDays !== undefined) update.modActionsDays = patch.modActionsDays;
      if (patch.modLogsDays !== undefined) update.modLogsDays = patch.modLogsDays;
      if (patch.transcriptDays !== undefined) update.transcriptDays = patch.transcriptDays;
      if (patch.snapshotDays !== undefined) update.snapshotDays = patch.snapshotDays;
      if (patch.auditLogDays !== undefined) update.auditLogDays = patch.auditLogDays;
      if (patch.redactPii !== undefined) update.redactPii = patch.redactPii;

      const policy = await app.prisma.retentionPolicy.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          modActionsDays: patch.modActionsDays ?? null,
          modLogsDays: patch.modLogsDays ?? null,
          transcriptDays: patch.transcriptDays ?? null,
          snapshotDays: patch.snapshotDays ?? null,
          auditLogDays: patch.auditLogDays ?? null,
          redactPii: patch.redactPii ?? false,
        },
      });
      return {
        guildId: policy.guildId,
        modActionsDays: policy.modActionsDays,
        modLogsDays: policy.modLogsDays,
        transcriptDays: policy.transcriptDays,
        snapshotDays: policy.snapshotDays,
        auditLogDays: policy.auditLogDays,
        redactPii: policy.redactPii,
      };
    },
  );

  // ─── Bot ping: enumerate guilds with a policy for daily prune sweep ──
  app.get(
    '/retention-policies',
    { preHandler: app.requireBot() },
    async () => {
      const policies = await app.prisma.retentionPolicy.findMany({
        select: { guildId: true },
      });
      return { guildIds: policies.map((p) => p.guildId) };
    },
  );

  // ─── Bot trigger: prune one guild on demand (used by scheduler) ──────
  app.post(
    '/guilds/:gid/retention-prune',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { pruneGuild } = await import('../util/retention-pruner.js');
      const result = await pruneGuild(app.prisma, req.params.gid);
      return result;
    },
  );

  // ─── Session-authed dashboard endpoints ──────────────────────────────
  app.get(
    '/admin/guilds/:gid/retention-policy',
    {
      preHandler: app.requireSession(),
      schema: { params: GuildParams },
    },
    async (req, reply) => {
      const guildId = req.params.gid;
      await ensureManageGuild(app, req, reply, guildId);
      const policy = await app.prisma.retentionPolicy.findUnique({ where: { guildId } });
      return {
        guildId,
        modActionsDays: policy?.modActionsDays ?? null,
        modLogsDays: policy?.modLogsDays ?? null,
        transcriptDays: policy?.transcriptDays ?? null,
        snapshotDays: policy?.snapshotDays ?? null,
        auditLogDays: policy?.auditLogDays ?? null,
        redactPii: policy?.redactPii ?? false,
      };
    },
  );

  app.put(
    '/admin/guilds/:gid/retention-policy',
    {
      preHandler: app.requireSession(),
      schema: { params: GuildParams, body: UpsertRetentionPolicySchema },
    },
    async (req, reply) => {
      const guildId = req.params.gid;
      await ensureManageGuild(app, req, reply, guildId);
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.modActionsDays !== undefined) update.modActionsDays = patch.modActionsDays;
      if (patch.modLogsDays !== undefined) update.modLogsDays = patch.modLogsDays;
      if (patch.transcriptDays !== undefined) update.transcriptDays = patch.transcriptDays;
      if (patch.snapshotDays !== undefined) update.snapshotDays = patch.snapshotDays;
      if (patch.auditLogDays !== undefined) update.auditLogDays = patch.auditLogDays;
      if (patch.redactPii !== undefined) update.redactPii = patch.redactPii;
      const policy = await app.prisma.retentionPolicy.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          modActionsDays: patch.modActionsDays ?? null,
          modLogsDays: patch.modLogsDays ?? null,
          transcriptDays: patch.transcriptDays ?? null,
          snapshotDays: patch.snapshotDays ?? null,
          auditLogDays: patch.auditLogDays ?? null,
          redactPii: patch.redactPii ?? false,
        },
      });
      return {
        guildId: policy.guildId,
        modActionsDays: policy.modActionsDays,
        modLogsDays: policy.modLogsDays,
        transcriptDays: policy.transcriptDays,
        snapshotDays: policy.snapshotDays,
        auditLogDays: policy.auditLogDays,
        redactPii: policy.redactPii,
      };
    },
  );
};
