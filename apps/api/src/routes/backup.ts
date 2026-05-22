import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  ConfigSnapshot as PrismaConfigSnapshot,
  Prisma,
  SnapshotPolicy as PrismaSnapshotPolicy,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateSnapshotSchema,
  SnapshotPayloadSchema,
  SnowflakeSchema,
  UpsertSnapshotPolicySchema,
  type SnapshotPayload,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import {
  collectGuildConfigSnapshot,
  serializeSnapshotPayload,
} from '../util/snapshot.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const SnapshotParams = z.object({
  guildId: SnowflakeSchema,
  snapshotId: z.string().uuid(),
});

function serializeMeta(s: PrismaConfigSnapshot) {
  return {
    id: s.id,
    guildId: s.guildId,
    createdAt: s.createdAt.toISOString(),
    label: s.label,
    sizeBytes: s.sizeBytes,
    createdBy: s.createdBy,
  };
}

function serializeDetail(s: PrismaConfigSnapshot) {
  return {
    ...serializeMeta(s),
    payload: s.payload as SnapshotPayload,
  };
}

function serializePolicy(guildId: string, p: PrismaSnapshotPolicy | null) {
  return {
    guildId,
    autoEnabled: p?.autoEnabled ?? false,
    retentionDays: p?.retentionDays ?? 30,
    updatedAt: (p?.updatedAt ?? new Date()).toISOString(),
  };
}

/**
 * Per-table restore step. Each call clears rows scoped to `guildId` (for
 * tables that have a direct `guildId`) or via the parent panel (for
 * ReactionRoleOption), then bulk-inserts whatever was in the snapshot. Runs
 * inside the caller's `$transaction` so a mid-restore failure rolls back the
 * whole set.
 */
async function restoreTable(
  tx: Prisma.TransactionClient,
  table: string,
  rows: unknown[],
  guildId: string,
): Promise<void> {
  const data = rows as Prisma.JsonObject[];
  switch (table) {
    case 'WelcomeConfig':
      await tx.welcomeConfig.deleteMany({ where: { guildId } });
      if (data.length) await tx.welcomeConfig.createMany({ data: data as never });
      return;
    case 'LoggingConfig':
      await tx.loggingConfig.deleteMany({ where: { guildId } });
      if (data.length) await tx.loggingConfig.createMany({ data: data as never });
      return;
    case 'WarningPolicy':
      await tx.warningPolicy.deleteMany({ where: { guildId } });
      if (data.length) await tx.warningPolicy.createMany({ data: data as never });
      return;
    case 'AutomodConfig':
      await tx.automodConfig.deleteMany({ where: { guildId } });
      if (data.length) await tx.automodConfig.createMany({ data: data as never });
      return;
    case 'VerificationConfig':
      await tx.verificationConfig.deleteMany({ where: { guildId } });
      if (data.length) await tx.verificationConfig.createMany({ data: data as never });
      return;
    case 'LevelConfig':
      await tx.levelConfig.deleteMany({ where: { guildId } });
      if (data.length) await tx.levelConfig.createMany({ data: data as never });
      return;
    case 'EconomyConfig':
      await tx.economyConfig.deleteMany({ where: { guildId } });
      if (data.length) await tx.economyConfig.createMany({ data: data as never });
      return;
    case 'TicketConfig':
      await tx.ticketConfig.deleteMany({ where: { guildId } });
      if (data.length) await tx.ticketConfig.createMany({ data: data as never });
      return;
    case 'TicketCategory':
      // Tickets reference categories with onDelete: SetNull, so wiping
      // categories is safe (the live tickets just lose their category link).
      await tx.ticketCategory.deleteMany({ where: { guildId } });
      if (data.length) await tx.ticketCategory.createMany({ data: data as never });
      return;
    case 'ReactionRolePanel':
      // Cascades to ReactionRoleOption — we'll re-insert the options below.
      await tx.reactionRolePanel.deleteMany({ where: { guildId } });
      if (data.length) await tx.reactionRolePanel.createMany({ data: data as never });
      return;
    case 'ReactionRoleOption':
      // Panels were already cleared above; their cascade wiped options too.
      // We just re-create from the snapshot.
      if (data.length) await tx.reactionRoleOption.createMany({ data: data as never });
      return;
    case 'BirthdayConfig':
      await tx.birthdayConfig.deleteMany({ where: { guildId } });
      if (data.length) await tx.birthdayConfig.createMany({ data: data as never });
      return;
    case 'StickyMessage':
      await tx.stickyMessage.deleteMany({ where: { guildId } });
      if (data.length) await tx.stickyMessage.createMany({ data: data as never });
      return;
    case 'CustomCommand':
      await tx.customCommand.deleteMany({ where: { guildId } });
      if (data.length) await tx.customCommand.createMany({ data: data as never });
      return;
    case 'Tag':
      await tx.tag.deleteMany({ where: { guildId } });
      if (data.length) await tx.tag.createMany({ data: data as never });
      return;
    case 'AutoResponse':
      await tx.autoResponse.deleteMany({ where: { guildId } });
      if (data.length) await tx.autoResponse.createMany({ data: data as never });
      return;
    case 'ShopItem':
      // InventoryEntry references shop items with onDelete: Cascade — restoring
      // shop items wipes any owned inventory rows. That's the trade-off for
      // restoring economy *config*; we accept it.
      await tx.shopItem.deleteMany({ where: { guildId } });
      if (data.length) await tx.shopItem.createMany({ data: data as never });
      return;
    case 'IntegrationSubscription':
      await tx.integrationSubscription.deleteMany({ where: { guildId } });
      if (data.length) await tx.integrationSubscription.createMany({ data: data as never });
      return;
    case 'ScheduledAnnouncement':
      await tx.scheduledAnnouncement.deleteMany({ where: { guildId } });
      if (data.length) await tx.scheduledAnnouncement.createMany({ data: data as never });
      return;
    default:
      // Unknown tables in older snapshots are silently skipped so a v0.26
      // restore can read a v0.27 snapshot that adds a new model.
      return;
  }
}

export const backupRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/snapshots',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.configSnapshot.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          guildId: true,
          createdAt: true,
          label: true,
          sizeBytes: true,
          createdBy: true,
        },
      });
      return {
        snapshots: items.map((s) => ({
          id: s.id,
          guildId: s.guildId,
          createdAt: s.createdAt.toISOString(),
          label: s.label,
          sizeBytes: s.sizeBytes,
          createdBy: s.createdBy,
        })),
      };
    },
  );

  app.get(
    '/guilds/:guildId/snapshots/:snapshotId',
    { preHandler: app.requireBot(), schema: { params: SnapshotParams } },
    async (req) => {
      const item = await app.prisma.configSnapshot.findFirst({
        where: { id: req.params.snapshotId, guildId: req.params.guildId },
      });
      if (!item) throw HttpError.notFound('Snapshot not found.');
      return serializeDetail(item);
    },
  );

  app.post(
    '/guilds/:guildId/snapshots',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateSnapshotSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const payload = await collectGuildConfigSnapshot(app.prisma, guildId);
      const { json, sizeBytes } = serializeSnapshotPayload(payload);
      const label = req.body.label?.trim() || `manual-${new Date().toISOString()}`;
      const created = await app.prisma.configSnapshot.create({
        data: {
          guildId,
          label,
          payload: json as never,
          sizeBytes,
          createdBy: req.body.createdBy ?? null,
        },
      });
      return serializeMeta(created);
    },
  );

  app.post(
    '/guilds/:guildId/snapshots/:snapshotId/restore',
    { preHandler: app.requireBot(), schema: { params: SnapshotParams } },
    async (req) => {
      const item = await app.prisma.configSnapshot.findFirst({
        where: { id: req.params.snapshotId, guildId: req.params.guildId },
      });
      if (!item) throw HttpError.notFound('Snapshot not found.');

      const parsed = SnapshotPayloadSchema.safeParse(item.payload);
      if (!parsed.success) {
        throw HttpError.badRequest('Snapshot payload is malformed.', parsed.error.flatten());
      }
      const payload = parsed.data;

      // Restore order matters: panels before options so the FK is satisfied.
      const order = [
        'WelcomeConfig',
        'LoggingConfig',
        'WarningPolicy',
        'AutomodConfig',
        'VerificationConfig',
        'LevelConfig',
        'EconomyConfig',
        'TicketConfig',
        'TicketCategory',
        'ReactionRolePanel',
        'ReactionRoleOption',
        'BirthdayConfig',
        'StickyMessage',
        'CustomCommand',
        'Tag',
        'AutoResponse',
        'ShopItem',
        'IntegrationSubscription',
        'ScheduledAnnouncement',
      ];

      const tableCounts: Record<string, number> = {};
      await app.prisma.$transaction(async (tx) => {
        for (const table of order) {
          const rows = payload[table] ?? [];
          tableCounts[table] = rows.length;
          await restoreTable(tx, table, rows, req.params.guildId);
        }
      });

      return {
        restored: true,
        snapshotId: item.id,
        tables: tableCounts,
      };
    },
  );

  app.delete(
    '/guilds/:guildId/snapshots/:snapshotId',
    { preHandler: app.requireBot(), schema: { params: SnapshotParams } },
    async (req, reply) => {
      const result = await app.prisma.configSnapshot.deleteMany({
        where: { id: req.params.snapshotId, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Snapshot not found.');
      return reply.code(204).send();
    },
  );

  app.get(
    '/guilds/:guildId/snapshot-policy',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const policy = await app.prisma.snapshotPolicy.findUnique({ where: { guildId } });
      return serializePolicy(guildId, policy);
    },
  );

  app.put(
    '/guilds/:guildId/snapshot-policy',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertSnapshotPolicySchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const update: Record<string, unknown> = {};
      if (req.body.autoEnabled !== undefined) update.autoEnabled = req.body.autoEnabled;
      if (req.body.retentionDays !== undefined) update.retentionDays = req.body.retentionDays;

      const policy = await app.prisma.snapshotPolicy.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          autoEnabled: req.body.autoEnabled ?? false,
          retentionDays: req.body.retentionDays ?? 30,
        },
      });
      return serializePolicy(guildId, policy);
    },
  );

  // ─── Bot scheduler entry points ──────────────────────────────────────
  // The bot's daily tick polls this list to discover which guilds need a
  // fresh auto-snapshot and to prune old ones.
  app.get(
    '/snapshot-policies/auto-enabled',
    { preHandler: app.requireBot() },
    async () => {
      const policies = await app.prisma.snapshotPolicy.findMany({
        where: { autoEnabled: true },
      });
      return {
        policies: policies.map((p) => ({
          guildId: p.guildId,
          autoEnabled: p.autoEnabled,
          retentionDays: p.retentionDays,
          updatedAt: p.updatedAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/guilds/:guildId/snapshots/prune',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        body: z.object({ retentionDays: z.number().int().min(1).max(365) }),
      },
    },
    async (req) => {
      const cutoff = new Date(Date.now() - req.body.retentionDays * 86_400_000);
      const result = await app.prisma.configSnapshot.deleteMany({
        where: { guildId: req.params.guildId, createdAt: { lt: cutoff } },
      });
      return { pruned: result.count };
    },
  );
};
