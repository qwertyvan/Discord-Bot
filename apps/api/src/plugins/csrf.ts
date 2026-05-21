import fp from 'fastify-plugin';
import { HttpError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Origin-check CSRF guard for session-authenticated routes.
 *
 * The session cookie is `SameSite=Lax`, which already blocks most cross-site
 * POSTs, but it does not block all browsers / older versions and it does not
 * block same-site cross-origin POSTs. We therefore additionally require that
 * mutating requests under /admin/* and /auth/logout originate from WEB_ORIGIN.
 *
 * Bot-only routes (which use Bearer auth, not cookies) are exempt — they are
 * server-to-server and not browser-reachable.
 */
export default fp(async (app) => {
  const webOrigin = app.config.WEB_ORIGIN;

  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method)) return;

    const url = req.url;
    const isProtected = url.startsWith('/admin/') || url === '/auth/logout';
    if (!isProtected) return;

    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const candidate = origin ?? (referer ? new URL(referer).origin : null);

    if (candidate !== webOrigin) {
      throw HttpError.forbidden('Cross-origin request rejected.');
    }
  });
});
