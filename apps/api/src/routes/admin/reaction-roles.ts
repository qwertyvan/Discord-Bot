import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateReactionRolePanelSchema,
  SnowflakeSchema,
  UpdateReactionRolePanelSchema,
} from '@discord-bot/shared';
import { HttpError } from '../../errors.js';
import { DiscordAuthError } from '../../discord.js';
import { getManageableGuilds, invalidatePermissionsCache } from '../../guild-permissions.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const PanelParams = z.object({ guildId: SnowflakeSchema, panelId: z.string().uuid() });

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
    const manageable = await getManageableGuilds(dbUser.discordId, dbUser.accessToken);
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

export const adminReactionRolesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireSession());

  app.get(
    '/admin/guilds/:guildId/reaction-role-panels',
    { schema: { params: GuildParams } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const panels = await app.prisma.reactionRolePanel.findMany({
        where: { guildId },
        include: { options: true },
        orderBy: { name: 'asc' },
      });
      return {
        panels: panels.map((p) => ({
          id: p.id,
          guildId: p.guildId,
          channelId: p.channelId,
          messageId: p.messageId,
          name: p.name,
          description: p.description,
          exclusive: p.exclusive,
          useDropdown: p.useDropdown,
          options: p.options
            .sort((a, b) => a.position - b.position)
            .map((o) => ({
              id: o.id,
              panelId: o.panelId,
              roleId: o.roleId,
              label: o.label,
              description: o.description,
              emoji: o.emoji,
              position: o.position,
            })),
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/admin/guilds/:guildId/reaction-role-panels',
    { schema: { params: GuildParams, body: CreateReactionRolePanelSchema } },
    async (req, reply) => {
      const { guildId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const { options, ...rest } = req.body;
      const panel = await app.prisma.reactionRolePanel.create({
        data: {
          guildId,
          channelId: rest.channelId,
          name: rest.name,
          description: rest.description ?? null,
          exclusive: rest.exclusive ?? false,
          useDropdown: rest.useDropdown ?? options.length > 5,
          options: {
            create: options.map((o, i) => ({
              roleId: o.roleId,
              label: o.label,
              description: o.description ?? null,
              emoji: o.emoji ?? null,
              position: o.position ?? i,
            })),
          },
        },
        include: { options: true },
      });
      reply.code(201);
      return { id: panel.id };
    },
  );

  app.patch(
    '/admin/guilds/:guildId/reaction-role-panels/:panelId',
    { schema: { params: PanelParams, body: UpdateReactionRolePanelSchema } },
    async (req, reply) => {
      const { guildId, panelId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const existing = await app.prisma.reactionRolePanel.findFirst({
        where: { id: panelId, guildId },
      });
      if (!existing) throw HttpError.notFound('Panel not found.');
      const patch = req.body;
      const update: Record<string, unknown> = {};
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.name !== undefined) update.name = patch.name;
      if (patch.description !== undefined) update.description = patch.description;
      if (patch.exclusive !== undefined) update.exclusive = patch.exclusive;
      if (patch.useDropdown !== undefined) update.useDropdown = patch.useDropdown;
      if (patch.messageId !== undefined) update.messageId = patch.messageId;

      await app.prisma.$transaction(async (tx) => {
        await tx.reactionRolePanel.update({ where: { id: panelId }, data: update });
        if (patch.options) {
          await tx.reactionRoleOption.deleteMany({ where: { panelId } });
          await tx.reactionRoleOption.createMany({
            data: patch.options.map((o, i) => ({
              panelId,
              roleId: o.roleId,
              label: o.label,
              description: o.description ?? null,
              emoji: o.emoji ?? null,
              position: o.position ?? i,
            })),
          });
        }
      });
      return { id: panelId };
    },
  );

  app.delete(
    '/admin/guilds/:guildId/reaction-role-panels/:panelId',
    { schema: { params: PanelParams } },
    async (req, reply) => {
      const { guildId, panelId } = req.params;
      await ensureGuildAccess(app, req, reply, guildId);
      const result = await app.prisma.reactionRolePanel.deleteMany({
        where: { id: panelId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Panel not found.');
      return reply.code(204).send();
    },
  );
};
