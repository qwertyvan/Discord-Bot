import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ReactionRolePanel, ReactionRoleOption } from '@prisma/client';
import { z } from 'zod';
import {
  CreateReactionRolePanelSchema,
  SnowflakeSchema,
  UpdateReactionRolePanelSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const PanelParams = z.object({ guildId: SnowflakeSchema, panelId: z.string().uuid() });

function serializePanel(panel: ReactionRolePanel & { options: ReactionRoleOption[] }) {
  return {
    id: panel.id,
    guildId: panel.guildId,
    channelId: panel.channelId,
    messageId: panel.messageId,
    name: panel.name,
    description: panel.description,
    exclusive: panel.exclusive,
    useDropdown: panel.useDropdown,
    options: panel.options
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
    createdAt: panel.createdAt.toISOString(),
    updatedAt: panel.updatedAt.toISOString(),
  };
}

export const reactionRolesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/reaction-role-panels',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const panels = await app.prisma.reactionRolePanel.findMany({
        where: { guildId },
        include: { options: true },
        orderBy: { name: 'asc' },
      });
      return { panels: panels.map(serializePanel) };
    },
  );

  app.get(
    '/guilds/:guildId/reaction-role-panels/:panelId',
    { preHandler: app.requireBot(), schema: { params: PanelParams } },
    async (req) => {
      const { guildId, panelId } = req.params;
      const panel = await app.prisma.reactionRolePanel.findFirst({
        where: { id: panelId, guildId },
        include: { options: true },
      });
      if (!panel) throw HttpError.notFound('Panel not found.');
      return serializePanel(panel);
    },
  );

  app.post(
    '/guilds/:guildId/reaction-role-panels',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateReactionRolePanelSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
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
      return serializePanel(panel);
    },
  );

  app.patch(
    '/guilds/:guildId/reaction-role-panels/:panelId',
    {
      preHandler: app.requireBot(),
      schema: { params: PanelParams, body: UpdateReactionRolePanelSchema },
    },
    async (req) => {
      const { guildId, panelId } = req.params;
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

      const panel = await app.prisma.reactionRolePanel.findUniqueOrThrow({
        where: { id: panelId },
        include: { options: true },
      });
      return serializePanel(panel);
    },
  );

  app.delete(
    '/guilds/:guildId/reaction-role-panels/:panelId',
    { preHandler: app.requireBot(), schema: { params: PanelParams } },
    async (req, reply) => {
      const { guildId, panelId } = req.params;
      const result = await app.prisma.reactionRolePanel.deleteMany({
        where: { id: panelId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Panel not found.');
      return reply.code(204).send();
    },
  );
};
