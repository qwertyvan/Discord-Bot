import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  InviteCode as PrismaInviteCode,
  MemberInvite as PrismaMemberInvite,
  InviteGatedRole as PrismaInviteGatedRole,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateMemberInviteSchema,
  SnowflakeSchema,
  UpdateMemberInviteSchema,
  UpsertInviteCodeSchema,
  UpsertInviteGatedRoleSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const InviteCodeParams = z.object({ guildId: SnowflakeSchema, code: z.string().min(1).max(32) });
const InviteGatedRoleParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });
const MemberInviteParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });
const ByUserParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });

function serializeInviteCode(i: PrismaInviteCode) {
  return {
    code: i.code,
    guildId: i.guildId,
    inviterId: i.inviterId,
    channelId: i.channelId,
    maxUses: i.maxUses,
    uses: i.uses,
    expiresAt: i.expiresAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

function serializeMemberInvite(m: PrismaMemberInvite) {
  return {
    guildId: m.guildId,
    userId: m.userId,
    inviterId: m.inviterId,
    inviteCode: m.inviteCode,
    joinedAt: m.joinedAt.toISOString(),
    leftAt: m.leftAt?.toISOString() ?? null,
    isFake: m.isFake,
  };
}

function serializeGatedRole(r: PrismaInviteGatedRole) {
  return {
    id: r.id,
    guildId: r.guildId,
    inviteCode: r.inviteCode,
    roleId: r.roleId,
  };
}

export const invitesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Invite codes ────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/invites',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.inviteCode.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { createdAt: 'desc' },
      });
      return { invites: items.map(serializeInviteCode) };
    },
  );

  app.post(
    '/guilds/:guildId/invites',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertInviteCodeSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const body = req.body;
      const updateData: Record<string, unknown> = {};
      if (body.inviterId !== undefined) updateData['inviterId'] = body.inviterId;
      if (body.channelId !== undefined) updateData['channelId'] = body.channelId;
      if (body.maxUses !== undefined) updateData['maxUses'] = body.maxUses;
      if (body.uses !== undefined) updateData['uses'] = body.uses;
      if (body.expiresAt !== undefined)
        updateData['expiresAt'] = body.expiresAt ? new Date(body.expiresAt) : null;
      const item = await app.prisma.inviteCode.upsert({
        where: { code: body.code },
        update: updateData,
        create: {
          code: body.code,
          guildId,
          inviterId: body.inviterId ?? null,
          channelId: body.channelId ?? null,
          maxUses: body.maxUses ?? null,
          uses: body.uses ?? 0,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        },
      });
      return serializeInviteCode(item);
    },
  );

  app.delete(
    '/guilds/:guildId/invites/:code',
    { preHandler: app.requireBot(), schema: { params: InviteCodeParams } },
    async (req, reply) => {
      const result = await app.prisma.inviteCode.deleteMany({
        where: { code: req.params.code, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Invite code not found.');
      return reply.code(204).send();
    },
  );

  // ─── Inviter leaderboard ─────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/invites/leaderboard',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
      },
    },
    async (req) => {
      const groups = await app.prisma.memberInvite.groupBy({
        by: ['inviterId', 'isFake'],
        where: {
          guildId: req.params.guildId,
          inviterId: { not: null },
        },
        _count: { userId: true },
      });
      const tally = new Map<string, { real: number; fake: number }>();
      for (const g of groups) {
        if (!g.inviterId) continue;
        const cur = tally.get(g.inviterId) ?? { real: 0, fake: 0 };
        if (g.isFake) cur.fake += g._count.userId;
        else cur.real += g._count.userId;
        tally.set(g.inviterId, cur);
      }
      const entries = Array.from(tally.entries())
        .map(([inviterId, v]) => ({
          inviterId,
          real: v.real,
          fake: v.fake,
          total: v.real + v.fake,
        }))
        .sort((a, b) => b.real - a.real || b.total - a.total)
        .slice(0, req.query.limit);
      return { entries };
    },
  );

  // ─── Per-user stats ──────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/invites/by-user/:userId',
    { preHandler: app.requireBot(), schema: { params: ByUserParams } },
    async (req) => {
      const rows = await app.prisma.memberInvite.findMany({
        where: {
          guildId: req.params.guildId,
          inviterId: req.params.userId,
        },
        select: { isFake: true },
      });
      const real = rows.filter((r) => !r.isFake).length;
      const fake = rows.filter((r) => r.isFake).length;
      return {
        inviterId: req.params.userId,
        real,
        fake,
        total: real + fake,
      };
    },
  );

  // ─── Member-invite join records ──────────────────────────────────────
  app.post(
    '/guilds/:guildId/member-invites',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateMemberInviteSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const body = req.body;
      const item = await app.prisma.memberInvite.upsert({
        where: { guildId_userId: { guildId, userId: body.userId } },
        update: {
          ...(body.inviterId !== undefined ? { inviterId: body.inviterId } : {}),
          ...(body.inviteCode !== undefined ? { inviteCode: body.inviteCode } : {}),
          joinedAt: new Date(),
          leftAt: null,
          isFake: false,
        },
        create: {
          guildId,
          userId: body.userId,
          inviterId: body.inviterId ?? null,
          inviteCode: body.inviteCode ?? null,
        },
      });
      return serializeMemberInvite(item);
    },
  );

  app.patch(
    '/guilds/:guildId/member-invites/:userId',
    {
      preHandler: app.requireBot(),
      schema: { params: MemberInviteParams, body: UpdateMemberInviteSchema },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const body = req.body;
      const data: Record<string, unknown> = {};
      if (body.leftAt !== undefined) data['leftAt'] = body.leftAt ? new Date(body.leftAt) : null;
      if (body.isFake !== undefined) data['isFake'] = body.isFake;
      const item = await app.prisma.memberInvite.update({
        where: { guildId_userId: { guildId, userId } },
        data,
      });
      return serializeMemberInvite(item);
    },
  );

  // ─── Invite-gated roles ──────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/invite-gated-roles',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.inviteGatedRole.findMany({
        where: { guildId: req.params.guildId },
      });
      return { rules: items.map(serializeGatedRole) };
    },
  );

  app.post(
    '/guilds/:guildId/invite-gated-roles',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertInviteGatedRoleSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const item = await app.prisma.inviteGatedRole.upsert({
        where: {
          guildId_inviteCode_roleId: {
            guildId,
            inviteCode: req.body.inviteCode,
            roleId: req.body.roleId,
          },
        },
        update: {},
        create: {
          guildId,
          inviteCode: req.body.inviteCode,
          roleId: req.body.roleId,
        },
      });
      return serializeGatedRole(item);
    },
  );

  app.delete(
    '/guilds/:guildId/invite-gated-roles/:id',
    { preHandler: app.requireBot(), schema: { params: InviteGatedRoleParams } },
    async (req, reply) => {
      const result = await app.prisma.inviteGatedRole.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Invite-gated role not found.');
      return reply.code(204).send();
    },
  );
};
