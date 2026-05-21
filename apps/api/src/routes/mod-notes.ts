import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CreateModNoteSchema, SnowflakeSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const Params = z.object({ guildId: SnowflakeSchema });
const ItemParams = z.object({ guildId: SnowflakeSchema, noteId: z.string().uuid() });
const UserParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });

export const modNotesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/guilds/:guildId/mod-notes',
    {
      preHandler: app.requireBot(),
      schema: { params: Params, body: CreateModNoteSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const note = await app.prisma.modNote.create({
        data: { guildId, ...req.body },
      });
      return {
        id: note.id,
        guildId: note.guildId,
        userId: note.userId,
        moderatorId: note.moderatorId,
        content: note.content,
        createdAt: note.createdAt.toISOString(),
      };
    },
  );

  app.get(
    '/guilds/:guildId/users/:userId/mod-notes',
    {
      preHandler: app.requireBot(),
      schema: { params: UserParams },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const notes = await app.prisma.modNote.findMany({
        where: { guildId, userId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        notes: notes.map((n) => ({
          id: n.id,
          guildId: n.guildId,
          userId: n.userId,
          moderatorId: n.moderatorId,
          content: n.content,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  );

  app.delete(
    '/guilds/:guildId/mod-notes/:noteId',
    {
      preHandler: app.requireBot(),
      schema: { params: ItemParams },
    },
    async (req, reply) => {
      const { guildId, noteId } = req.params;
      const result = await app.prisma.modNote.deleteMany({
        where: { id: noteId, guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Note not found.');
      return reply.code(204).send();
    },
  );
};
