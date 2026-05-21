import fp from 'fastify-plugin';
import oauth2Default, {
  type OAuth2Namespace,
  type ProviderConfiguration,
} from '@fastify/oauth2';

declare module 'fastify' {
  interface FastifyInstance {
    discordOAuth: OAuth2Namespace;
  }
}

// `@fastify/oauth2` uses `export =` so the static `DISCORD_CONFIGURATION` is not
// visible on the default-imported function under TS's esModuleInterop. The value
// is present at runtime; cast through unknown to access it without `any`.
const oauth2 = oauth2Default as typeof oauth2Default & {
  DISCORD_CONFIGURATION: ProviderConfiguration;
};

export default fp(async (app) => {
  const isProd = app.config.NODE_ENV === 'production';
  await app.register(oauth2, {
    name: 'discordOAuth',
    scope: ['identify', 'guilds'],
    credentials: {
      client: {
        id: app.config.DISCORD_CLIENT_ID,
        secret: app.config.DISCORD_CLIENT_SECRET,
      },
      auth: oauth2.DISCORD_CONFIGURATION,
    },
    startRedirectPath: '/auth/discord/login',
    callbackUri: app.config.DISCORD_OAUTH_REDIRECT_URL,
    // Harden the OAuth state cookie — defaults leave `secure` off.
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      signed: true,
      path: '/',
    },
  });
});
