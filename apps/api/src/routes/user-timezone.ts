import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SnowflakeSchema } from '@discord-bot/shared';

const UserParams = z.object({ userId: SnowflakeSchema });

// IANA timezone identifier — a non-trivial whitelist is overkill, so we just
// validate basic shape and let the bot reject anything not understood by
// Intl.DateTimeFormat when it tries to use it.
const TimezoneSchema = z.string().regex(/^[A-Za-z0-9_+\-/]{1,64}$/);

export const userTimezoneRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/users/:userId/timezone',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req) => {
      const row = await app.prisma.userTimezone.findUnique({ where: { userId: req.params.userId } });
      return { userId: req.params.userId, tz: row?.tz ?? null };
    },
  );

  app.put(
    '/users/:userId/timezone',
    {
      preHandler: app.requireBot(),
      schema: { params: UserParams, body: z.object({ tz: TimezoneSchema }) },
    },
    async (req) => {
      const row = await app.prisma.userTimezone.upsert({
        where: { userId: req.params.userId },
        update: { tz: req.body.tz },
        create: { userId: req.params.userId, tz: req.body.tz },
      });
      return { userId: row.userId, tz: row.tz };
    },
  );

  app.delete(
    '/users/:userId/timezone',
    { preHandler: app.requireBot(), schema: { params: UserParams } },
    async (req, reply) => {
      await app.prisma.userTimezone.deleteMany({ where: { userId: req.params.userId } });
      return reply.code(204).send();
    },
  );
};
