import fp from 'fastify-plugin';
import { loadEnv, type Env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
  }
}

export default fp(async (app) => {
  app.decorate('config', loadEnv());
});
