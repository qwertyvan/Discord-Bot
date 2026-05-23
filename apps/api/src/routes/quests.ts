import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  QuestTemplate as PrismaQuestTemplate,
  UserQuest as PrismaUserQuest,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateQuestTemplateSchema,
  ProgressEventSchema,
  QuestCadenceSchema,
  QuestKindSchema,
  SnowflakeSchema,
  UpdateQuestTemplateSchema,
  type QuestCadence,
  type QuestKind,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const SlugParams = z.object({ guildId: SnowflakeSchema, slug: z.string().min(1).max(48) });
const UserQuestParams = z.object({
  guildId: SnowflakeSchema,
  id: z.string().uuid(),
});
const UserParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function cadenceWindowMs(cadence: QuestCadence): number {
  return cadence === 'weekly' ? WEEK_MS : DAY_MS;
}

function serializeTemplate(t: PrismaQuestTemplate) {
  return {
    id: t.id,
    guildId: t.guildId,
    slug: t.slug,
    name: t.name,
    description: t.description,
    kind: t.kind as QuestKind,
    targetCount: t.targetCount,
    targetChannelId: t.targetChannelId,
    cadence: t.cadence as QuestCadence,
    rewardCurrency: t.rewardCurrency,
    rewardXp: t.rewardXp,
    rewardRoleId: t.rewardRoleId,
    enabled: t.enabled,
    createdAt: t.createdAt.toISOString(),
  };
}

function serializeUserQuest(q: PrismaUserQuest & { template: PrismaQuestTemplate }) {
  return {
    id: q.id,
    guildId: q.guildId,
    userId: q.userId,
    templateId: q.templateId,
    template: serializeTemplate(q.template),
    progress: q.progress,
    completedAt: q.completedAt?.toISOString() ?? null,
    claimedAt: q.claimedAt?.toISOString() ?? null,
    periodStartedAt: q.periodStartedAt.toISOString(),
    expiresAt: q.expiresAt.toISOString(),
  };
}

const STOCK_TEMPLATES: Array<{
  slug: string;
  name: string;
  description: string;
  kind: QuestKind;
  targetCount: number;
  cadence: QuestCadence;
  rewardCurrency: number;
  rewardXp: number;
}> = [
  {
    slug: 'daily-chatter',
    name: 'Daily Chatter',
    description: 'Send 10 messages today.',
    kind: 'send_messages',
    targetCount: 10,
    cadence: 'daily',
    rewardCurrency: 50,
    rewardXp: 25,
  },
  {
    slug: 'daily-reactor',
    name: 'Daily Reactor',
    description: 'React to 5 messages today.',
    kind: 'react_messages',
    targetCount: 5,
    cadence: 'daily',
    rewardCurrency: 20,
    rewardXp: 10,
  },
  {
    slug: 'weekly-conversationalist',
    name: 'Weekly Conversationalist',
    description: 'Send 100 messages this week.',
    kind: 'send_messages',
    targetCount: 100,
    cadence: 'weekly',
    rewardCurrency: 500,
    rewardXp: 250,
  },
  {
    slug: 'weekly-voice',
    name: 'Voice Veteran',
    description: 'Spend 60 minutes in voice this week.',
    kind: 'voice_minutes',
    targetCount: 60,
    cadence: 'weekly',
    rewardCurrency: 400,
    rewardXp: 200,
  },
];

export const questsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── QuestTemplate CRUD ──────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/quest-templates',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const templates = await app.prisma.questTemplate.findMany({
        where: { guildId: req.params.guildId },
        orderBy: [{ cadence: 'asc' }, { createdAt: 'asc' }],
      });
      return { templates: templates.map(serializeTemplate) };
    },
  );

  app.post(
    '/guilds/:guildId/quest-templates',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateQuestTemplateSchema },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const body = req.body;
      if (body.kind === 'send_in_channel' && !body.targetChannelId) {
        throw HttpError.badRequest('send_in_channel templates require targetChannelId.');
      }
      try {
        const tmpl = await app.prisma.questTemplate.create({
          data: {
            guildId,
            slug: body.slug,
            name: body.name,
            ...(body.description !== undefined ? { description: body.description } : {}),
            kind: body.kind,
            targetCount: body.targetCount,
            ...(body.targetChannelId !== undefined
              ? { targetChannelId: body.targetChannelId }
              : {}),
            cadence: body.cadence,
            rewardCurrency: body.rewardCurrency,
            rewardXp: body.rewardXp,
            ...(body.rewardRoleId !== undefined ? { rewardRoleId: body.rewardRoleId } : {}),
            enabled: body.enabled,
          },
        });
        reply.code(201);
        return serializeTemplate(tmpl);
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') {
          throw HttpError.conflict('A quest template with that slug already exists.');
        }
        throw err;
      }
    },
  );

  app.patch(
    '/guilds/:guildId/quest-templates/:slug',
    {
      preHandler: app.requireBot(),
      schema: { params: SlugParams, body: UpdateQuestTemplateSchema },
    },
    async (req) => {
      const { guildId, slug } = req.params;
      const existing = await app.prisma.questTemplate.findUnique({
        where: { guildId_slug: { guildId, slug } },
      });
      if (!existing) throw HttpError.notFound('Quest template not found.');
      const body = req.body;
      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.description !== undefined) data.description = body.description;
      if (body.kind !== undefined) data.kind = body.kind;
      if (body.targetCount !== undefined) data.targetCount = body.targetCount;
      if (body.targetChannelId !== undefined) data.targetChannelId = body.targetChannelId;
      if (body.cadence !== undefined) data.cadence = body.cadence;
      if (body.rewardCurrency !== undefined) data.rewardCurrency = body.rewardCurrency;
      if (body.rewardXp !== undefined) data.rewardXp = body.rewardXp;
      if (body.rewardRoleId !== undefined) data.rewardRoleId = body.rewardRoleId;
      if (body.enabled !== undefined) data.enabled = body.enabled;
      const tmpl = await app.prisma.questTemplate.update({
        where: { guildId_slug: { guildId, slug } },
        data,
      });
      return serializeTemplate(tmpl);
    },
  );

  app.delete(
    '/guilds/:guildId/quest-templates/:slug',
    { preHandler: app.requireBot(), schema: { params: SlugParams } },
    async (req, reply) => {
      const result = await app.prisma.questTemplate.deleteMany({
        where: { guildId: req.params.guildId, slug: req.params.slug },
      });
      if (result.count === 0) throw HttpError.notFound('Quest template not found.');
      return reply.code(204).send();
    },
  );

  // Seed stock templates — idempotent on (guildId, slug).
  app.post(
    '/guilds/:guildId/quest-templates/seed',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const inserted: string[] = [];
      const skipped: string[] = [];
      for (const t of STOCK_TEMPLATES) {
        try {
          await app.prisma.questTemplate.create({
            data: {
              guildId,
              slug: t.slug,
              name: t.name,
              description: t.description,
              kind: t.kind,
              targetCount: t.targetCount,
              cadence: t.cadence,
              rewardCurrency: t.rewardCurrency,
              rewardXp: t.rewardXp,
              enabled: true,
            },
          });
          inserted.push(t.slug);
        } catch (err) {
          if ((err as { code?: string })?.code === 'P2002') {
            skipped.push(t.slug);
            continue;
          }
          throw err;
        }
      }
      return { inserted, skipped };
    },
  );

  // ─── User quest list (auto-assign daily + weekly slots) ──────────────
  app.get(
    '/guilds/:guildId/user-quests/:userId',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const now = new Date();

      // Drop expired unclaimed rows so we can rotate in fresh templates.
      await app.prisma.userQuest.deleteMany({
        where: {
          guildId,
          userId,
          claimedAt: null,
          expiresAt: { lt: now },
        },
      });

      // Active rows the user already has — keyed by templateId so we don't
      // double-assign within a period.
      const active = await app.prisma.userQuest.findMany({
        where: {
          guildId,
          userId,
          OR: [{ claimedAt: null }, { claimedAt: { not: null } }],
          expiresAt: { gt: now },
        },
        include: { template: true },
      });
      const haveTemplateIds = new Set(active.map((q) => q.templateId));

      // Auto-assign one enabled template per cadence that isn't already
      // running for this user. Older templates get priority (createdAt asc)
      // so seeded stock quests show up first.
      const enabledTemplates = await app.prisma.questTemplate.findMany({
        where: { guildId, enabled: true },
        orderBy: [{ cadence: 'asc' }, { createdAt: 'asc' }],
      });

      const cadencesPresent = new Set(active.map((q) => q.template.cadence));
      const toAssign: PrismaQuestTemplate[] = [];
      for (const tmpl of enabledTemplates) {
        if (cadencesPresent.has(tmpl.cadence)) continue;
        if (haveTemplateIds.has(tmpl.id)) continue;
        toAssign.push(tmpl);
        cadencesPresent.add(tmpl.cadence);
      }

      for (const tmpl of toAssign) {
        const cadence = tmpl.cadence as QuestCadence;
        const expiresAt = new Date(now.getTime() + cadenceWindowMs(cadence));
        try {
          await app.prisma.userQuest.create({
            data: {
              guildId,
              userId,
              templateId: tmpl.id,
              periodStartedAt: now,
              expiresAt,
            },
          });
        } catch (err) {
          // Tolerate races with concurrent /user-quests reads — the unique
          // index on (guildId, userId, templateId, periodStartedAt) will
          // protect against duplicates.
          if ((err as { code?: string })?.code !== 'P2002') throw err;
        }
      }

      const refreshed = await app.prisma.userQuest.findMany({
        where: { guildId, userId, expiresAt: { gt: now } },
        include: { template: true },
        orderBy: [{ template: { cadence: 'asc' } }, { periodStartedAt: 'asc' }],
      });
      return { quests: refreshed.map(serializeUserQuest) };
    },
  );

  // ─── Progress event (bot-bearer; debounced from the bot quest-bus) ───
  app.post(
    '/guilds/:guildId/user-quests/progress',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: ProgressEventSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId, kind, channelId, delta } = req.body;
      const now = new Date();

      const active = await app.prisma.userQuest.findMany({
        where: {
          guildId,
          userId,
          completedAt: null,
          expiresAt: { gt: now },
          template: { kind, enabled: true },
        },
        include: { template: true },
      });

      const updated: Array<ReturnType<typeof serializeUserQuest>> = [];
      for (const q of active) {
        // Channel-scoped objectives only count when the event channel matches.
        if (q.template.targetChannelId && q.template.targetChannelId !== channelId) continue;
        const newProgress = Math.min(q.progress + delta, q.template.targetCount);
        const justCompleted = newProgress >= q.template.targetCount;
        const fresh = await app.prisma.userQuest.update({
          where: { id: q.id },
          data: {
            progress: newProgress,
            ...(justCompleted ? { completedAt: now } : {}),
          },
          include: { template: true },
        });
        updated.push(serializeUserQuest(fresh));
      }
      return { updated };
    },
  );

  // ─── Claim a completed quest ─────────────────────────────────────────
  app.post(
    '/guilds/:guildId/user-quests/:id/claim',
    { preHandler: app.requireBot(), schema: { params: UserQuestParams } },
    async (req) => {
      const { guildId, id } = req.params;
      const q = await app.prisma.userQuest.findFirst({
        where: { id, guildId },
        include: { template: true },
      });
      if (!q) throw HttpError.notFound('Quest not found.');
      if (!q.completedAt) throw HttpError.badRequest('Quest is not yet complete.');
      if (q.claimedAt) throw HttpError.conflict('Quest reward already claimed.');

      const claimedAt = new Date();
      // Pay currency reward via Balance upsert.
      if (q.template.rewardCurrency > 0) {
        await app.prisma.balance.upsert({
          where: { guildId_userId: { guildId, userId: q.userId } },
          update: { amount: { increment: q.template.rewardCurrency } },
          create: { guildId, userId: q.userId, amount: q.template.rewardCurrency },
        });
      }
      // Pay XP reward via MemberLevel upsert. (Level math runs lazily on
      // the next levelFromXp() lookup elsewhere — we don't fire level-up
      // announcements from here.)
      if (q.template.rewardXp > 0) {
        await app.prisma.memberLevel.upsert({
          where: { guildId_userId: { guildId, userId: q.userId } },
          update: { xp: { increment: q.template.rewardXp } },
          create: { guildId, userId: q.userId, xp: q.template.rewardXp },
        });
      }

      const updated = await app.prisma.userQuest.update({
        where: { id: q.id },
        data: { claimedAt },
        include: { template: true },
      });

      // Cascade "complete_other_quest" objectives — any active such row
      // for this user advances by 1.
      const chained = await app.prisma.userQuest.findMany({
        where: {
          guildId,
          userId: q.userId,
          completedAt: null,
          expiresAt: { gt: claimedAt },
          template: { kind: 'complete_other_quest', enabled: true },
        },
        include: { template: true },
      });
      for (const c of chained) {
        const newProgress = Math.min(c.progress + 1, c.template.targetCount);
        const justCompleted = newProgress >= c.template.targetCount;
        await app.prisma.userQuest.update({
          where: { id: c.id },
          data: {
            progress: newProgress,
            ...(justCompleted ? { completedAt: claimedAt } : {}),
          },
        });
      }

      return {
        quest: serializeUserQuest(updated),
        rewards: {
          currency: q.template.rewardCurrency,
          xp: q.template.rewardXp,
          roleId: q.template.rewardRoleId,
        },
      };
    },
  );

  // ─── Expiry sweep (bot-bearer; called by scheduler hourly) ───────────
  app.post(
    '/quests/expire',
    { preHandler: app.requireBot() },
    async () => {
      const now = new Date();
      const result = await app.prisma.userQuest.deleteMany({
        where: { claimedAt: null, expiresAt: { lt: now } },
      });
      return { deleted: result.count };
    },
  );

  // Internal helper export: silence unused warning for the imported
  // QuestCadenceSchema/QuestKindSchema — Zod imports may otherwise look
  // unused to the linter when the route schemas reference them only
  // through CreateQuestTemplateSchema.
  void QuestCadenceSchema;
  void QuestKindSchema;
};
