import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SnowflakeSchema, UpdateWelcomeConfigSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const Params = z.object({ guildId: SnowflakeSchema });

export const welcomeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/welcome',
    {
      preHandler: app.requireBot(),
      schema: { params: Params },
    },
    async (req) => {
      const { guildId } = req.params;
      const config = await app.prisma.welcomeConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: config?.enabled ?? false,
        channelId: config?.channelId ?? null,
        joinTemplate: config?.joinTemplate ?? null,
        leaveTemplate: config?.leaveTemplate ?? null,
      };
    },
  );

  app.put(
    '/guilds/:guildId/welcome',
    {
      preHandler: app.requireBot(),
      schema: {
        params: Params,
        body: UpdateWelcomeConfigSchema,
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const patch = req.body;

      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      // Strip undefined keys so Prisma's update input (which uses non-undefined
      // optional fields) accepts the patch under exactOptionalPropertyTypes.
      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.joinTemplate !== undefined) update.joinTemplate = patch.joinTemplate;
      if (patch.leaveTemplate !== undefined) update.leaveTemplate = patch.leaveTemplate;

      const config = await app.prisma.welcomeConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          joinTemplate: patch.joinTemplate ?? null,
          leaveTemplate: patch.leaveTemplate ?? null,
        },
      });
      return {
        guildId: config.guildId,
        enabled: config.enabled,
        channelId: config.channelId,
        joinTemplate: config.joinTemplate,
        leaveTemplate: config.leaveTemplate,
      };
    },
  );
};
