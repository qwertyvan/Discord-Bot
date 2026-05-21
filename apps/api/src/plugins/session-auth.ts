import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest as _FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { HttpError } from '../errors.js';

export interface SessionUser {
  sessionId: string;
  userId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
  interface FastifyInstance {
    requireSession: () => (req: _FastifyRequest) => Promise<void>;
    issueSession: (reply: FastifyReply, session: { id: string; expiresAt: Date }) => void;
    clearSession: (reply: FastifyReply) => void;
  }
}

export default fp(async (app) => {
  await app.register(cookie, { secret: app.config.SESSION_SECRET });

  const cookieName = app.config.SESSION_COOKIE_NAME;
  const isProd = app.config.NODE_ENV === 'production';

  // Default: no user attached.
  app.decorateRequest('user', null);

  // Resolve the session (if any) from the signed cookie on every request.
  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[cookieName];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;

    const session = await app.prisma.session.findUnique({
      where: { id: unsigned.value },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) return;

    req.user = {
      sessionId: session.id,
      userId: session.user.discordId,
      username: session.user.username,
      globalName: session.user.globalName,
      avatarUrl: session.user.avatarUrl,
    };
  });

  app.decorate('requireSession', () => async (req) => {
    if (!req.user) throw HttpError.unauthorized('No active session.');
  });

  app.decorate('issueSession', (reply, session) => {
    reply.setCookie(cookieName, session.id, {
      signed: true,
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
  });

  app.decorate('clearSession', (reply) => {
    reply.clearCookie(cookieName, { path: '/' });
  });
});
