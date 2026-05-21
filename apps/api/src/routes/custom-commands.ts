import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { CustomCommand as PrismaCustomCommand } from '@prisma/client';
import { z } from 'zod';
import {
  CreateCustomCommandSchema,
  SnowflakeSchema,
  UpdateCustomCommandSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ItemParams = z.object({
  guildId: SnowflakeSchema,
  name: z.string().min(1).max(32),
});

function serialize(c: PrismaCustomCommand) {
  return {
    id: c.id,
    guildId: c.guildId,
    name: c.name,
    description: c.description,
    response: c.response,
    createdBy: c.createdBy,
    uses: c.uses,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const customCommandsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/custom-commands',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.customCommand.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { name: 'asc' },
      });
      return { commands: items.map(serialize) };
    },
  );

  app.get(
    '/guilds/:guildId/custom-commands/:name',
    { preHandler: app.requireBot(), schema: { params: ItemParams } },
    async (req) => {
      const item = await app.prisma.customCommand.findUnique({
        where: { guildId_name: { guildId: req.params.guildId, name: req.params.name.toLowerCase() } },
      });
      if (!item) throw HttpError.notFound('Custom command not found.');
      return serialize(item);
    },
  );

  app.post(
    '/guilds/:guildId/custom-commands',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateCustomCommandSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      try {
        const created = await app.prisma.customCommand.create({
          data: {
            guildId,
            name: req.body.name,
            description: req.body.description,
            response: req.body.response,
            createdBy: req.body.createdBy,
          },
        });
        return serialize(created);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          throw HttpError.conflict('A command with that name already exists.');
        }
        throw err;
      }
    },
  );

  app.patch(
    '/guilds/:guildId/custom-commands/:name',
    {
      preHandler: app.requireBot(),
      schema: { params: ItemParams, body: UpdateCustomCommandSchema },
    },
    async (req) => {
      const updated = await app.prisma.customCommand.update({
        where: {
          guildId_name: { guildId: req.params.guildId, name: req.params.name.toLowerCase() },
        },
        data: {
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.response !== undefined ? { response: req.body.response } : {}),
        },
      });
      return serialize(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/custom-commands/:name',
    { preHandler: app.requireBot(), schema: { params: ItemParams } },
    async (req, reply) => {
      const result = await app.prisma.customCommand.deleteMany({
        where: { guildId: req.params.guildId, name: req.params.name.toLowerCase() },
      });
      if (result.count === 0) throw HttpError.notFound('Custom command not found.');
      return reply.code(204).send();
    },
  );

  app.post(
    '/guilds/:guildId/custom-commands/:name/touch',
    { preHandler: app.requireBot(), schema: { params: ItemParams } },
    async (req) => {
      const updated = await app.prisma.customCommand.update({
        where: {
          guildId_name: { guildId: req.params.guildId, name: req.params.name.toLowerCase() },
        },
        data: { uses: { increment: 1 } },
      });
      return serialize(updated);
    },
  );
};
