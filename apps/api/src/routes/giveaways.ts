import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  Giveaway as PrismaGiveaway,
  GiveawayEntry as PrismaGiveawayEntry,
  GiveawayWinner as PrismaGiveawayWinner,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateGiveawaySchema,
  EnterGiveawaySchema,
  GiveawayStatusSchema,
  SnowflakeSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { DiscordAuthError } from '../discord.js';
import { decryptTokenOrPlaintext } from '../crypto.js';
import { getManageableGuilds, invalidatePermissionsCache } from '../guild-permissions.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const GiveawayParams = z.object({
  guildId: SnowflakeSchema,
  giveawayId: z.string().uuid(),
});

type GiveawayWithRels = PrismaGiveaway & {
  entries: PrismaGiveawayEntry[];
  winners: PrismaGiveawayWinner[];
};

function serializeWinner(w: PrismaGiveawayWinner) {
  return {
    id: w.id,
    giveawayId: w.giveawayId,
    userId: w.userId,
    drawAt: w.drawAt.toISOString(),
  };
}

function serializeGiveaway(g: GiveawayWithRels) {
  return {
    id: g.id,
    guildId: g.guildId,
    channelId: g.channelId,
    messageId: g.messageId,
    prize: g.prize,
    hostId: g.hostId,
    endsAt: g.endsAt.toISOString(),
    winnerCount: g.winnerCount,
    requireRoleId: g.requireRoleId,
    requireMinLevel: g.requireMinLevel,
    weightedBonusRoles: g.weightedBonusRoles,
    status: g.status as 'active' | 'ended' | 'cancelled',
    createdAt: g.createdAt.toISOString(),
    entryCount: g.entries.length,
    winners: g.winners.map(serializeWinner),
  };
}

function hasBotBearer(app: FastifyInstance, req: FastifyRequest): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length);
  return provided === app.config.BOT_API_TOKEN;
}

/**
 * Authorize a mutation that either the bot (via bot-bearer) or a logged-in
 * dashboard user with Manage Server on the guild may invoke. The slash
 * commands route through the bot; the dashboard routes through a session.
 */
async function requireBotOrManageGuild(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  guildId: string,
): Promise<void> {
  if (hasBotBearer(app, req)) return;
  if (!req.user) throw HttpError.unauthorized();
  await ensureGuildAccess(app, req, reply, guildId);
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

/**
 * Draw `winnerCount` winners weighted by each entry's `weight`. Replaces any
 * previously-recorded winners for this giveaway in the same transaction so
 * /reroll yields a clean swap.
 */
async function drawAndRecordWinners(
  app: FastifyInstance,
  giveawayId: string,
  winnerCount: number,
): Promise<PrismaGiveawayWinner[]> {
  const entries = await app.prisma.giveawayEntry.findMany({ where: { giveawayId } });
  if (entries.length === 0) return [];

  const pool = entries.map((e) => ({ userId: e.userId, weight: Math.max(1, e.weight) }));
  const picked: string[] = [];
  const want = Math.min(winnerCount, pool.length);
  while (picked.length < want && pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= pool[idx]!.weight;
      if (roll <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    const chosen = pool[idx]!;
    picked.push(chosen.userId);
    pool.splice(idx, 1);
  }

  return app.prisma.$transaction(async (tx) => {
    await tx.giveawayWinner.deleteMany({ where: { giveawayId } });
    if (picked.length === 0) return [];
    await tx.giveawayWinner.createMany({
      data: picked.map((userId) => ({ giveawayId, userId })),
    });
    return tx.giveawayWinner.findMany({
      where: { giveawayId },
      orderBy: { drawAt: 'asc' },
    });
  });
}

async function loadGiveaway(
  app: FastifyInstance,
  guildId: string,
  giveawayId: string,
): Promise<GiveawayWithRels> {
  const g = await app.prisma.giveaway.findFirst({
    where: { id: giveawayId, guildId },
    include: { entries: true, winners: { orderBy: { drawAt: 'asc' } } },
  });
  if (!g) throw HttpError.notFound('Giveaway not found.');
  return g;
}

export const giveawaysRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Due (bot-bearer) — giveaways past endsAt still active ──────────
  app.get(
    '/giveaways/due',
    {
      preHandler: app.requireBot(),
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const due = await app.prisma.giveaway.findMany({
        where: { status: 'active', endsAt: { lte: new Date() } },
        include: { entries: true, winners: { orderBy: { drawAt: 'asc' } } },
        take: req.query.limit,
      });
      return { giveaways: due.map(serializeGiveaway) };
    },
  );

  // ─── Read ────────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/giveaways',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          status: GiveawayStatusSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const items = await app.prisma.giveaway.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        include: { entries: true, winners: { orderBy: { drawAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { giveaways: items.map(serializeGiveaway) };
    },
  );

  app.get(
    '/guilds/:guildId/giveaways/:giveawayId',
    { preHandler: app.requireBot(), schema: { params: GiveawayParams } },
    async (req) => {
      const g = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      return serializeGiveaway(g);
    },
  );

  // ─── Create ──────────────────────────────────────────────────────────
  app.post(
    '/guilds/:guildId/giveaways',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateGiveawaySchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const created = await app.prisma.giveaway.create({
        data: {
          guildId,
          channelId: req.body.channelId,
          prize: req.body.prize,
          hostId: req.body.hostId,
          endsAt: new Date(req.body.endsAt),
          winnerCount: req.body.winnerCount ?? 1,
          requireRoleId: req.body.requireRoleId ?? null,
          requireMinLevel: req.body.requireMinLevel ?? null,
          weightedBonusRoles: req.body.weightedBonusRoles ?? [],
          status: 'active',
        },
        include: { entries: true, winners: true },
      });
      return serializeGiveaway(created);
    },
  );

  // ─── Set messageId after first post ──────────────────────────────────
  app.post(
    '/guilds/:guildId/giveaways/:giveawayId/messageId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GiveawayParams,
        body: z.object({ messageId: SnowflakeSchema.nullable() }),
      },
    },
    async (req) => {
      const existing = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      await app.prisma.giveaway.update({
        where: { id: existing.id },
        data: { messageId: req.body.messageId },
      });
      const refreshed = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      return serializeGiveaway(refreshed);
    },
  );

  // ─── Enter (bot calls this when a user clicks the Enter button) ──────
  app.post(
    '/guilds/:guildId/giveaways/:giveawayId/enter',
    {
      preHandler: app.requireBot(),
      schema: { params: GiveawayParams, body: EnterGiveawaySchema },
    },
    async (req) => {
      const existing = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      if (existing.status !== 'active') {
        throw HttpError.conflict('Giveaway is not accepting entries.');
      }
      if (existing.endsAt.getTime() <= Date.now()) {
        throw HttpError.conflict('Giveaway has already ended.');
      }
      const weight = req.body.weight ?? 1;
      await app.prisma.giveawayEntry.upsert({
        where: {
          giveawayId_userId: {
            giveawayId: existing.id,
            userId: req.body.userId,
          },
        },
        update: { weight },
        create: {
          giveawayId: existing.id,
          userId: req.body.userId,
          weight,
        },
      });
      const refreshed = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      return serializeGiveaway(refreshed);
    },
  );

  // ─── End: draw winners, flip to 'ended' (bot-bearer) ────────────────
  app.post(
    '/guilds/:guildId/giveaways/:giveawayId/end',
    { preHandler: app.requireBot(), schema: { params: GiveawayParams } },
    async (req) => {
      const existing = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      if (existing.status === 'cancelled') {
        throw HttpError.conflict('Giveaway was cancelled.');
      }
      if (existing.status !== 'ended') {
        await drawAndRecordWinners(app, existing.id, existing.winnerCount);
        await app.prisma.giveaway.update({
          where: { id: existing.id },
          data: { status: 'ended' },
        });
      }
      const refreshed = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      return serializeGiveaway(refreshed);
    },
  );

  // ─── Reroll (bot-bearer or session + ManageGuild) ────────────────────
  app.post(
    '/guilds/:guildId/giveaways/:giveawayId/reroll',
    { schema: { params: GiveawayParams } },
    async (req, reply) => {
      await requireBotOrManageGuild(app, req, reply, req.params.guildId);
      const existing = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      if (existing.status !== 'ended') {
        throw HttpError.conflict('Can only reroll an ended giveaway.');
      }
      await drawAndRecordWinners(app, existing.id, existing.winnerCount);
      const refreshed = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      return serializeGiveaway(refreshed);
    },
  );

  // ─── Cancel (bot-bearer or session + ManageGuild) ────────────────────
  app.post(
    '/guilds/:guildId/giveaways/:giveawayId/cancel',
    { schema: { params: GiveawayParams } },
    async (req, reply) => {
      await requireBotOrManageGuild(app, req, reply, req.params.guildId);
      const existing = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      if (existing.status === 'cancelled') {
        return serializeGiveaway(existing);
      }
      await app.prisma.giveaway.update({
        where: { id: existing.id },
        data: { status: 'cancelled' },
      });
      const refreshed = await loadGiveaway(app, req.params.guildId, req.params.giveawayId);
      return serializeGiveaway(refreshed);
    },
  );
};
