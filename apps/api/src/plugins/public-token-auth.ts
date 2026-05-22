import fp from 'fastify-plugin';
import { createHash } from 'node:crypto';
import type { FastifyRequest as _FastifyRequest } from 'fastify';
import type { PublicApiScope } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * preHandler factory for public-API routes. Validates a Bearer token from
     * the `Authorization` header, looks up the matching (non-revoked) row by
     * SHA-256 hash, and verifies the required scope. On success, bumps
     * `lastUsedAt` and attaches the token's guildId to the request.
     */
    requirePublicToken: (
      scope: PublicApiScope,
    ) => (req: _FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    publicTokenGuildId?: string;
  }
}

export function hashPublicToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export default fp(async (app) => {
  app.decorateRequest('publicTokenGuildId', undefined);

  app.decorate('requirePublicToken', (scope) => async (req) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw HttpError.unauthorized('Missing bearer token.');
    }
    const provided = header.slice('Bearer '.length).trim();
    if (provided.length < 16) {
      throw HttpError.unauthorized('Invalid token.');
    }

    const tokenHash = hashPublicToken(provided);
    const row = await app.prisma.publicApiToken.findUnique({
      where: { tokenHash },
    });
    if (!row || row.revokedAt) {
      throw HttpError.unauthorized('Invalid token.');
    }
    if (!row.scopes.includes(scope)) {
      throw HttpError.forbidden(`Token missing required scope: ${scope}`);
    }

    // Best-effort lastUsedAt bump. We don't await to keep the hot path lean,
    // but we do swallow errors so a transient DB hiccup doesn't 500 the call.
    app.prisma.publicApiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    req.publicTokenGuildId = row.guildId;
  });
});
