import type { FastifyPluginAsync } from 'fastify';
import { getCurrentUser, userAvatarUrl } from '../discord.js';
import { invalidatePermissionsCache } from '../guild-permissions.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  // /auth/discord/login is registered automatically by @fastify/oauth2.

  app.get('/auth/discord/callback', async (req, reply) => {
    const token = await app.discordOAuth.getAccessTokenFromAuthorizationCodeFlow(req);
    const accessToken = token.token.access_token as string;
    const expiresAt = new Date(Date.now() + Number(token.token.expires_in ?? 0) * 1000);

    const me = await getCurrentUser(accessToken);

    await app.prisma.adminUser.upsert({
      where: { discordId: me.id },
      update: {
        username: me.username,
        globalName: me.global_name,
        avatarUrl: userAvatarUrl(me),
        accessToken,
        tokenExpiresAt: expiresAt,
        lastSeenAt: new Date(),
      },
      create: {
        discordId: me.id,
        username: me.username,
        globalName: me.global_name,
        avatarUrl: userAvatarUrl(me),
        accessToken,
        tokenExpiresAt: expiresAt,
      },
    });

    const sessionExpiresAt = new Date(Date.now() + app.config.SESSION_TTL_SECONDS * 1000);
    const session = await app.prisma.session.create({
      data: { userId: me.id, expiresAt: sessionExpiresAt },
    });

    app.issueSession(reply, { id: session.id, expiresAt: sessionExpiresAt });
    return reply.redirect(app.config.WEB_ORIGIN);
  });

  app.get('/auth/me', { preHandler: app.requireSession() }, async (req) => {
    return { user: req.user };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.user) {
      await app.prisma.session.delete({ where: { id: req.user.sessionId } }).catch(() => {});
      invalidatePermissionsCache(req.user.userId);
    }
    app.clearSession(reply);
    return { ok: true };
  });
};
