import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireBot: () => (req: FastifyRequest) => void;
  }
}

/**
 * Decorator that validates the `Authorization: Bearer <BOT_API_TOKEN>` header.
 * Attach to bot-only routes via `preHandler: app.requireBot()`.
 */
export default fp(async (app) => {
  const expected = app.config.BOT_API_TOKEN;
  const expectedBuf = Buffer.from(expected);

  app.decorate('requireBot', () => (req) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw HttpError.unauthorized('Missing bearer token.');
    }
    const provided = header.slice('Bearer '.length);
    const providedBuf = Buffer.from(provided);
    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw HttpError.unauthorized('Invalid bot token.');
    }
  });
});
