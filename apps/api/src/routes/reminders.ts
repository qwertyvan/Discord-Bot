import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Reminder } from '@prisma/client';
import { z } from 'zod';
import { CreateReminderSchema, SnowflakeSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

function serialize(r: Reminder) {
  return {
    id: r.id,
    guildId: r.guildId,
    userId: r.userId,
    channelId: r.channelId,
    content: r.content,
    runAt: r.runAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

export const remindersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/reminders',
    { preHandler: app.requireBot(), schema: { body: CreateReminderSchema } },
    async (req) => {
      const r = await app.prisma.reminder.create({
        data: {
          guildId: req.body.guildId ?? null,
          userId: req.body.userId,
          channelId: req.body.channelId ?? null,
          content: req.body.content,
          runAt: new Date(req.body.runAt),
        },
      });
      return serialize(r);
    },
  );

  app.get(
    '/users/:userId/reminders',
    {
      preHandler: app.requireBot(),
      schema: {
        params: z.object({ userId: SnowflakeSchema }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(25) }),
      },
    },
    async (req) => {
      const { userId } = req.params;
      const reminders = await app.prisma.reminder.findMany({
        where: { userId, runAt: { gte: new Date() } },
        orderBy: { runAt: 'asc' },
        take: req.query.limit,
      });
      return { reminders: reminders.map(serialize) };
    },
  );

  app.delete(
    '/reminders/:reminderId',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ reminderId: z.string().uuid() }) },
    },
    async (req, reply) => {
      const result = await app.prisma.reminder.deleteMany({ where: { id: req.params.reminderId } });
      if (result.count === 0) throw HttpError.notFound('Reminder not found.');
      return reply.code(204).send();
    },
  );

  // Due reminders endpoint — bot polls this and fires each.
  app.get(
    '/reminders/due',
    {
      preHandler: app.requireBot(),
      schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }) },
    },
    async (req) => {
      const due = await app.prisma.reminder.findMany({
        where: { runAt: { lte: new Date() } },
        orderBy: { runAt: 'asc' },
        take: req.query.limit,
      });
      return { reminders: due.map(serialize) };
    },
  );
};
