import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/health/db', async () => {
    await app.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'reachable' };
  });
};
