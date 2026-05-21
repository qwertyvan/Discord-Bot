import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { WelcomeConfig as PrismaWelcomeConfig } from '@prisma/client';
import { z } from 'zod';
import { SnowflakeSchema, UpdateWelcomeConfigSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const Params = z.object({ guildId: SnowflakeSchema });

function serialize(guildId: string, cfg: PrismaWelcomeConfig | null) {
  return {
    guildId,
    enabled: cfg?.enabled ?? false,
    channelId: cfg?.channelId ?? null,
    joinTemplate: cfg?.joinTemplate ?? null,
    leaveTemplate: cfg?.leaveTemplate ?? null,
    dmTemplate: cfg?.dmTemplate ?? null,
    autoRoleIds: (cfg?.autoRoleIds as string[]) ?? [],
    milestoneEvery: cfg?.milestoneEvery ?? null,
    milestoneTemplate: cfg?.milestoneTemplate ?? null,
    cardEnabled: cfg?.cardEnabled ?? false,
    cardBackgroundUrl: cfg?.cardBackgroundUrl ?? null,
  };
}

export const welcomeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/welcome',
    { preHandler: app.requireBot(), schema: { params: Params } },
    async (req) => {
      const { guildId } = req.params;
      const config = await app.prisma.welcomeConfig.findUnique({ where: { guildId } });
      return serialize(guildId, config);
    },
  );

  app.put(
    '/guilds/:guildId/welcome',
    { preHandler: app.requireBot(), schema: { params: Params, body: UpdateWelcomeConfigSchema } },
    async (req) => {
      const { guildId } = req.params;
      const patch = req.body;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.joinTemplate !== undefined) update.joinTemplate = patch.joinTemplate;
      if (patch.leaveTemplate !== undefined) update.leaveTemplate = patch.leaveTemplate;
      if (patch.dmTemplate !== undefined) update.dmTemplate = patch.dmTemplate;
      if (patch.autoRoleIds !== undefined) update.autoRoleIds = patch.autoRoleIds;
      if (patch.milestoneEvery !== undefined) update.milestoneEvery = patch.milestoneEvery;
      if (patch.milestoneTemplate !== undefined) update.milestoneTemplate = patch.milestoneTemplate;
      if (patch.cardEnabled !== undefined) update.cardEnabled = patch.cardEnabled;
      if (patch.cardBackgroundUrl !== undefined) update.cardBackgroundUrl = patch.cardBackgroundUrl;

      const config = await app.prisma.welcomeConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          joinTemplate: patch.joinTemplate ?? null,
          leaveTemplate: patch.leaveTemplate ?? null,
          dmTemplate: patch.dmTemplate ?? null,
          autoRoleIds: patch.autoRoleIds ?? [],
          milestoneEvery: patch.milestoneEvery ?? null,
          milestoneTemplate: patch.milestoneTemplate ?? null,
          cardEnabled: patch.cardEnabled ?? false,
          cardBackgroundUrl: patch.cardBackgroundUrl ?? null,
        },
      });
      return serialize(guildId, config);
    },
  );
};
