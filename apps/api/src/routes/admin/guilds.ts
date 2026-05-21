import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SnowflakeSchema, UpdateWelcomeConfigSchema } from '@discord-bot/shared';
import { HttpError } from '../../errors.js';
import { DiscordAuthError } from '../../discord.js';
import {
  getManageableGuilds,
  guildIconUrl,
  invalidatePermissionsCache,
} from '../../guild-permissions.js';

const Params = z.object({ guildId: SnowflakeSchema });
const WarningParams = z.object({ guildId: SnowflakeSchema, warningId: z.string().uuid() });

/**
 * Wraps a Discord-token-dependent call. If Discord rejects the token, we
 * tear down the session (the user must re-authenticate) and return 401.
 */
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

/**
 * Asserts the current session user has Manage Server on the requested guild
 * AND that the bot is registered for that guild.
 */
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

  const manageable = await withDiscordAuth(app, req, reply, () =>
    getManageableGuilds(dbUser.discordId, dbUser.accessToken),
  );
  if (!manageable.some((g) => g.id === guildId)) {
    throw HttpError.forbidden('You do not have Manage Server on this guild.');
  }

  const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) throw HttpError.notFound('Bot is not in that guild.');
}

export const adminGuildsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireSession());

  // List guilds where the user can administer AND the bot is present.
  app.get('/admin/guilds', async (req, reply) => {
    if (!req.user) throw HttpError.unauthorized();
    const dbUser = await app.prisma.adminUser.findUnique({
      where: { discordId: req.user.userId },
    });
    if (!dbUser) throw HttpError.unauthorized();

    const manageable = await withDiscordAuth(app, req, reply, () =>
      getManageableGuilds(dbUser.discordId, dbUser.accessToken),
    );
    const manageableIds = new Set(manageable.map((g) => g.id));

    const botGuilds = await app.prisma.guild.findMany({
      where: { id: { in: [...manageableIds] } },
      orderBy: { name: 'asc' },
    });

    return {
      guilds: botGuilds.map((g) => ({
        id: g.id,
        name: g.name,
        iconUrl:
          g.iconUrl ??
          guildIconUrl(manageable.find((m) => m.id === g.id) ?? { id: g.id, icon: null }),
        addedAt: g.addedAt.toISOString(),
      })),
    };
  });

  app.get(
    '/admin/guilds/:guildId/stats',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);

      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
      const [warningCount, warningsLast7d, welcome] = await Promise.all([
        app.prisma.warning.count({ where: { guildId } }),
        app.prisma.warning.count({ where: { guildId, createdAt: { gte: sevenDaysAgo } } }),
        app.prisma.welcomeConfig.findUnique({ where: { guildId } }),
      ]);

      return {
        guildId,
        warningCount,
        warningsLast7d,
        welcomeEnabled: welcome?.enabled ?? false,
      };
    },
  );

  app.get(
    '/admin/guilds/:guildId/warnings',
    {
      schema: {
        params: Params,
        querystring: z.object({
          userId: SnowflakeSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          cursor: z.string().uuid().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const { userId, limit, cursor } = req.query;

      const where = userId ? { guildId, userId } : { guildId };
      const items = await app.prisma.warning.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const last = page[page.length - 1];
      return {
        warnings: page.map((w) => ({
          id: w.id,
          guildId: w.guildId,
          userId: w.userId,
          moderatorId: w.moderatorId,
          reason: w.reason,
          createdAt: w.createdAt.toISOString(),
        })),
        nextCursor: hasMore && last ? last.id : null,
      };
    },
  );

  app.delete(
    '/admin/guilds/:guildId/warnings/:warningId',
    { schema: { params: WarningParams } },
    async (req, reply) => {
      const { guildId, warningId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const result = await app.prisma.warning.deleteMany({
        where: { id: warningId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Warning not found.');
      return reply.code(204).send();
    },
  );

  app.get(
    '/admin/guilds/:guildId/welcome',
    { schema: { params: Params } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const config = await app.prisma.welcomeConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: config?.enabled ?? false,
        channelId: config?.channelId ?? null,
        joinTemplate: config?.joinTemplate ?? null,
        leaveTemplate: config?.leaveTemplate ?? null,
      };
    },
  );

  app.put(
    '/admin/guilds/:guildId/welcome',
    { schema: { params: Params, body: UpdateWelcomeConfigSchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const patch = req.body;

      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.joinTemplate !== undefined) update.joinTemplate = patch.joinTemplate;
      if (patch.leaveTemplate !== undefined) update.leaveTemplate = patch.leaveTemplate;

      const config = await app.prisma.welcomeConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          joinTemplate: patch.joinTemplate ?? null,
          leaveTemplate: patch.leaveTemplate ?? null,
        },
      });
      return {
        guildId: config.guildId,
        enabled: config.enabled,
        channelId: config.channelId,
        joinTemplate: config.joinTemplate,
        leaveTemplate: config.leaveTemplate,
      };
    },
  );
};
