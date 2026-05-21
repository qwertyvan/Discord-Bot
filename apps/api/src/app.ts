import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import { ApiErrorCodes } from '@discord-bot/shared';
import configPlugin from './plugins/config.js';
import prismaPlugin from './plugins/prisma.js';
import botAuthPlugin from './plugins/bot-auth.js';
import sessionAuthPlugin from './plugins/session-auth.js';
import discordOAuthPlugin from './plugins/discord-oauth.js';
import csrfPlugin from './plugins/csrf.js';
import { healthRoutes } from './routes/health.js';
import { guildsRoutes } from './routes/guilds.js';
import { warningsRoutes } from './routes/warnings.js';
import { welcomeRoutes } from './routes/welcome.js';
import { authRoutes } from './routes/auth.js';
import { adminGuildsRoutes } from './routes/admin/guilds.js';
import { HttpError } from './errors.js';

export async function buildApp() {
  const loggerOptions: FastifyServerOptions['logger'] = {
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };

  const app = Fastify({ logger: loggerOptions }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(configPlugin);
  await app.register(cors, {
    origin: app.config.WEB_ORIGIN,
    credentials: true,
  });
  await app.register(prismaPlugin);
  await app.register(botAuthPlugin);
  await app.register(sessionAuthPlugin);
  await app.register(discordOAuthPlugin);
  await app.register(csrfPlugin);

  await app.register(healthRoutes);
  await app.register(guildsRoutes);
  await app.register(warningsRoutes);
  await app.register(welcomeRoutes);
  await app.register(authRoutes);
  await app.register(adminGuildsRoutes);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: ApiErrorCodes.BadRequest,
          message: 'Request validation failed.',
          details: err.validation,
        },
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') {
        return reply.code(404).send({
          error: { code: ApiErrorCodes.NotFound, message: 'Record not found.' },
        });
      }
      if (err.code === 'P2002') {
        return reply.code(409).send({
          error: {
            code: ApiErrorCodes.Conflict,
            message: 'Unique constraint violation.',
            details: { target: err.meta?.target },
          },
        });
      }
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({
      error: { code: ApiErrorCodes.Internal, message: 'Internal server error.' },
    });
  });

  return app;
}
