import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SnowflakeSchema, levelFromXp } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });

/**
 * Public, token-authed read API. Each route requires a PublicApiToken whose
 * `scopes` include the route's declared scope and whose `guildId` matches the
 * `:guildId` path param. The auth plugin attaches `req.publicTokenGuildId` —
 * we re-check it here so a token issued for guild A can never read guild B's
 * data, even if the URL is rewritten.
 */
export const publicRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/public/guilds/:guildId/stats',
    {
      preHandler: app.requirePublicToken('stats:read'),
      schema: { params: GuildParams },
    },
    async (req) => {
      const { guildId } = req.params;
      if (req.publicTokenGuildId !== guildId) {
        throw HttpError.forbidden('Token is not scoped to this guild.');
      }

      // Member count: derive from the most recent MEMBER_JOIN/LEAVE audit
      // events vs. current MemberLevel rows — we don't store a live count, so
      // expose null when we can't know it. Dashboards / front-ends should
      // tolerate null and fall back to a different source.
      const memberLevelCount = await app.prisma.memberLevel.count({ where: { guildId } });
      const memberCount = memberLevelCount > 0 ? memberLevelCount : null;

      const topRaw = await app.prisma.memberLevel.findMany({
        where: { guildId },
        orderBy: { xp: 'desc' },
        take: 10,
        select: { userId: true, xp: true },
      });
      const levelTop10 = topRaw.map((m) => ({
        userId: m.userId,
        xp: m.xp,
        level: levelFromXp(m.xp),
      }));

      return { memberCount, levelTop10 };
    },
  );
};
