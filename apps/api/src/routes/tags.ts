import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Tag } from '@prisma/client';
import { z } from 'zod';
import { CreateTagSchema, SnowflakeSchema, TagNameSchema, UpdateTagSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const TagParams = z.object({ guildId: SnowflakeSchema, name: TagNameSchema });

function serialize(t: Tag) {
  return {
    id: t.id,
    guildId: t.guildId,
    name: t.name,
    content: t.content,
    authorId: t.authorId,
    uses: t.uses,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export const tagsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/tags',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const tags = await app.prisma.tag.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { name: 'asc' },
      });
      return { tags: tags.map(serialize) };
    },
  );

  app.get(
    '/guilds/:guildId/tags/:name',
    { preHandler: app.requireBot(), schema: { params: TagParams } },
    async (req) => {
      const tag = await app.prisma.tag.findUnique({
        where: { guildId_name: { guildId: req.params.guildId, name: req.params.name } },
      });
      if (!tag) throw HttpError.notFound('Tag not found.');
      return serialize(tag);
    },
  );

  app.post(
    '/guilds/:guildId/tags',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateTagSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      try {
        const tag = await app.prisma.tag.create({
          data: { guildId, name: req.body.name, content: req.body.content, authorId: req.body.authorId },
        });
        return serialize(tag);
      } catch (err) {
        // Prisma P2002 → unique constraint violation
        if ((err as { code?: string })?.code === 'P2002') {
          throw HttpError.conflict('A tag with that name already exists.');
        }
        throw err;
      }
    },
  );

  app.patch(
    '/guilds/:guildId/tags/:name',
    {
      preHandler: app.requireBot(),
      schema: { params: TagParams, body: UpdateTagSchema },
    },
    async (req) => {
      const { guildId, name } = req.params;
      const tag = await app.prisma.tag.update({
        where: { guildId_name: { guildId, name } },
        data: { content: req.body.content },
      });
      return serialize(tag);
    },
  );

  app.delete(
    '/guilds/:guildId/tags/:name',
    { preHandler: app.requireBot(), schema: { params: TagParams } },
    async (req, reply) => {
      const result = await app.prisma.tag.deleteMany({
        where: { guildId: req.params.guildId, name: req.params.name },
      });
      if (result.count === 0) throw HttpError.notFound('Tag not found.');
      return reply.code(204).send();
    },
  );

  app.post(
    '/guilds/:guildId/tags/:name/touch',
    { preHandler: app.requireBot(), schema: { params: TagParams } },
    async (req) => {
      const tag = await app.prisma.tag.update({
        where: { guildId_name: { guildId: req.params.guildId, name: req.params.name } },
        data: { uses: { increment: 1 } },
      });
      return serialize(tag);
    },
  );
};
