import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SnowflakeSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

/**
 * Bot-facing guild registry: the bot announces guilds it joins/leaves so the
 * API knows which guilds exist. The admin-facing guild listing — filtered by
 * the caller's Discord OAuth2 permissions — lives in routes/admin/guilds.ts.
 */
export const guildsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Upsert a guild record (called by the bot on ready / guildCreate).
  app.put(
    '/guilds/:id',
    {
      preHandler: app.requireBot(),
      schema: {
        params: z.object({ id: SnowflakeSchema }),
        body: z.object({
          name: z.string().min(1).max(100),
          iconUrl: z.string().url().nullable().optional(),
        }),
      },
    },
    async (req) => {
      const { id } = req.params;
      const { name, iconUrl } = req.body;
      const guild = await app.prisma.guild.upsert({
        where: { id },
        update: { name, iconUrl: iconUrl ?? null },
        create: { id, name, iconUrl: iconUrl ?? null },
      });
      return {
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconUrl,
        addedAt: guild.addedAt.toISOString(),
      };
    },
  );

  // Remove a guild (called by the bot on guildDelete).
  app.delete(
    '/guilds/:id',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ id: SnowflakeSchema }) },
    },
    async (req, reply) => {
      const { id } = req.params;
      const result = await app.prisma.guild.deleteMany({ where: { id } });
      if (result.count === 0) {
        throw HttpError.notFound('Guild not found.');
      }
      return reply.code(204).send();
    },
  );
};
