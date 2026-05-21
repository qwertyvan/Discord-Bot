import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { SnowflakeSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

function randomSlug(length = 7): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}

export const shortLinksRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public redirect — no auth, with a small bump on `uses`.
  app.get(
    '/s/:slug',
    {
      schema: { params: z.object({ slug: z.string().min(1).max(32) }) },
    },
    async (req, reply) => {
      const link = await app.prisma.shortLink.findUnique({
        where: { slug: req.params.slug },
      });
      if (!link) return reply.code(404).send({ error: { code: 'not_found', message: 'No such link.' } });
      // Bump uses async-style — we don't want to block the redirect.
      app.prisma.shortLink
        .update({ where: { id: link.id }, data: { uses: { increment: 1 } } })
        .catch(() => {});
      return reply.redirect(link.target, 302);
    },
  );

  // Bot CRUD.
  app.post(
    '/short-links',
    {
      preHandler: app.requireBot(),
      schema: {
        body: z.object({
          target: z.string().url(),
          createdBy: SnowflakeSchema,
          guildId: SnowflakeSchema.optional(),
          slug: z
            .string()
            .min(3)
            .max(32)
            .regex(/^[a-zA-Z0-9_-]+$/)
            .optional(),
        }),
      },
    },
    async (req) => {
      let slug = req.body.slug ?? randomSlug();
      // Best-effort collision avoidance on the random path.
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await app.prisma.shortLink.findUnique({ where: { slug } });
        if (!existing) break;
        if (req.body.slug) throw HttpError.conflict('That slug is already taken.');
        slug = randomSlug();
      }
      const link = await app.prisma.shortLink.create({
        data: {
          slug,
          target: req.body.target,
          createdBy: req.body.createdBy,
          guildId: req.body.guildId ?? null,
        },
      });
      return {
        id: link.id,
        slug: link.slug,
        target: link.target,
        guildId: link.guildId,
        createdBy: link.createdBy,
        uses: link.uses,
        createdAt: link.createdAt.toISOString(),
      };
    },
  );

  app.get(
    '/short-links/by-slug/:slug',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ slug: z.string().min(1).max(32) }) },
    },
    async (req) => {
      const link = await app.prisma.shortLink.findUnique({ where: { slug: req.params.slug } });
      if (!link) throw HttpError.notFound('Link not found.');
      return {
        id: link.id,
        slug: link.slug,
        target: link.target,
        guildId: link.guildId,
        createdBy: link.createdBy,
        uses: link.uses,
        createdAt: link.createdAt.toISOString(),
      };
    },
  );

  app.delete(
    '/short-links/:slug',
    {
      preHandler: app.requireBot(),
      schema: { params: z.object({ slug: z.string().min(1).max(32) }) },
    },
    async (req, reply) => {
      const result = await app.prisma.shortLink.deleteMany({ where: { slug: req.params.slug } });
      if (result.count === 0) throw HttpError.notFound('Link not found.');
      return reply.code(204).send();
    },
  );
};
