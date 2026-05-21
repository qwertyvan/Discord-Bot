import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SnowflakeSchema, UpdateWarningPolicySchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const Params = z.object({ guildId: SnowflakeSchema });

export const warningPolicyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/warning-policy',
    {
      preHandler: app.requireBot(),
      schema: { params: Params },
    },
    async (req) => {
      const { guildId } = req.params;
      const policy = await app.prisma.warningPolicy.findUnique({ where: { guildId } });
      return {
        guildId,
        expireDays: policy?.expireDays ?? null,
        thresholds: (policy?.thresholds as unknown[]) ?? [],
        muteRoleId: policy?.muteRoleId ?? null,
      };
    },
  );

  app.put(
    '/guilds/:guildId/warning-policy',
    {
      preHandler: app.requireBot(),
      schema: { params: Params, body: UpdateWarningPolicySchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;

      const update: Record<string, unknown> = {};
      if (patch.expireDays !== undefined) update.expireDays = patch.expireDays;
      if (patch.thresholds !== undefined) update.thresholds = patch.thresholds;
      if (patch.muteRoleId !== undefined) update.muteRoleId = patch.muteRoleId;

      const policy = await app.prisma.warningPolicy.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          expireDays: patch.expireDays ?? null,
          thresholds: patch.thresholds ?? [],
          muteRoleId: patch.muteRoleId ?? null,
        },
      });
      return {
        guildId: policy.guildId,
        expireDays: policy.expireDays,
        thresholds: policy.thresholds as unknown[],
        muteRoleId: policy.muteRoleId,
      };
    },
  );
};
