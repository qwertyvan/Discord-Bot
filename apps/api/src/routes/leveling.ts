import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  SnowflakeSchema,
  UpdateLevelConfigSchema,
  levelFromXp,
  xpForLevel,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import { addVoiceXp, awardTextXp } from '../services/leveling.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const UserParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });

interface SerializableConfig {
  enabled: boolean;
  perMessageXp: number;
  textCooldownSeconds: number;
  voiceXpPerMinute: number;
  voiceXpEnabled?: boolean;
  levelUpChannelId: string | null;
  levelUpTemplate: string | null;
  channelMultipliers: unknown;
  roleRewards: unknown;
  noXpRoleIds: unknown;
  rankCardEnabled?: boolean;
}

function serializeConfig(guildId: string, cfg: SerializableConfig | null) {
  return {
    guildId,
    enabled: cfg?.enabled ?? false,
    perMessageXp: cfg?.perMessageXp ?? 15,
    textCooldownSeconds: cfg?.textCooldownSeconds ?? 60,
    voiceXpPerMinute: cfg?.voiceXpPerMinute ?? 5,
    voiceXpEnabled: cfg?.voiceXpEnabled ?? false,
    levelUpChannelId: cfg?.levelUpChannelId ?? null,
    levelUpTemplate: cfg?.levelUpTemplate ?? null,
    channelMultipliers: (cfg?.channelMultipliers as Record<string, number>) ?? {},
    roleRewards: (cfg?.roleRewards as Array<{ level: number; roleId: string }>) ?? [],
    noXpRoleIds: (cfg?.noXpRoleIds as string[]) ?? [],
    rankCardEnabled: cfg?.rankCardEnabled ?? false,
  };
}

export const levelingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/level-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.levelConfig.findUnique({ where: { guildId } });
      return serializeConfig(guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/level-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpdateLevelConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      for (const k of [
        'enabled',
        'perMessageXp',
        'textCooldownSeconds',
        'voiceXpPerMinute',
        'voiceXpEnabled',
        'levelUpChannelId',
        'levelUpTemplate',
        'channelMultipliers',
        'roleRewards',
        'noXpRoleIds',
        'rankCardEnabled',
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
          voiceXpEnabled: patch.voiceXpEnabled ?? false,
          levelUpChannelId: patch.levelUpChannelId ?? null,
          levelUpTemplate: patch.levelUpTemplate ?? null,
          channelMultipliers: (patch.channelMultipliers ?? {}) as Prisma.InputJsonValue,
          roleRewards: (patch.roleRewards ?? []) as Prisma.InputJsonValue,
          noXpRoleIds: (patch.noXpRoleIds ?? []) as Prisma.InputJsonValue,
          rankCardEnabled: patch.rankCardEnabled ?? false,
        },
      });
      return serializeConfig(guildId, cfg);
    },
  );

  // Bot calls this on every (non-bot) message — server-side cooldown.
  app.post(
    '/guilds/:guildId/level/award',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        body: z.object({ userId: SnowflakeSchema, channelId: SnowflakeSchema }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId, channelId } = req.body;
      return awardTextXp(app.prisma, guildId, userId, channelId);
    },
  );

  app.post(
    '/guilds/:guildId/level/voice',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        body: z.object({ userId: SnowflakeSchema, minutes: z.number().int().min(1).max(360) }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      return addVoiceXp(app.prisma, guildId, req.body.userId, req.body.minutes);
    },
  );

  app.get(
    '/guilds/:guildId/level/:userId',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const member = await app.prisma.memberLevel.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      const xp = member?.xp ?? 0;
      const lvl = levelFromXp(xp);
      // Rank: count members with strictly greater XP, +1.
      const higher = await app.prisma.memberLevel.count({
        where: { guildId, xp: { gt: xp } },
      });
      return {
        guildId,
        userId,
        xp,
        voiceMinutes: member?.voiceMinutes ?? 0,
        level: lvl,
        rank: member ? higher + 1 : null,
        currentLevelXp: xpForLevel(lvl),
        nextLevelXp: xpForLevel(lvl + 1),
      };
    },
  );

  app.get(
    '/guilds/:guildId/leaderboard',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
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

  app.post(
    '/guilds/:guildId/level/:userId/give',
    {
      preHandler: app.requireBot(),
      schema: {
        params: UserParams,
        body: z.object({ amount: z.number().int() }),
      },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const { amount } = req.body;
      const updated = await app.prisma.memberLevel.upsert({
        where: { guildId_userId: { guildId, userId } },
        update: { xp: { increment: amount } },
        create: { guildId, userId, xp: Math.max(0, amount) },
      });
      const adjustedXp = Math.max(0, updated.xp);
      if (adjustedXp !== updated.xp) {
        await app.prisma.memberLevel.update({
          where: { guildId_userId: { guildId, userId } },
          data: { xp: adjustedXp },
        });
      }
      return { guildId, userId, xp: adjustedXp, level: levelFromXp(adjustedXp) };
    },
  );

  app.delete(
    '/guilds/:guildId/level/:userId',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req, reply) => {
      const { guildId, userId } = req.params;
      await app.prisma.memberLevel.deleteMany({ where: { guildId, userId } });
      return reply.code(204).send();
    },
  );
};
