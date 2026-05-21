import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SnowflakeSchema, UpdateVerificationConfigSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const Params = z.object({ guildId: SnowflakeSchema });

export const verificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/guilds/:guildId/verification',
    { preHandler: app.requireBot(), schema: { params: Params } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.verificationConfig.findUnique({ where: { guildId } });
      return {
        guildId,
        enabled: cfg?.enabled ?? false,
        channelId: cfg?.channelId ?? null,
        messageId: cfg?.messageId ?? null,
        verifiedRoleId: cfg?.verifiedRoleId ?? null,
        buttonLabel: cfg?.buttonLabel ?? null,
        prompt: cfg?.prompt ?? null,
      };
    },
  );

  app.put(
    '/guilds/:guildId/verification',
    { preHandler: app.requireBot(), schema: { params: Params, body: UpdateVerificationConfigSchema } },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;

      const update: Record<string, unknown> = {};
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      if (patch.channelId !== undefined) update.channelId = patch.channelId;
      if (patch.messageId !== undefined) update.messageId = patch.messageId;
      if (patch.verifiedRoleId !== undefined) update.verifiedRoleId = patch.verifiedRoleId;
      if (patch.buttonLabel !== undefined) update.buttonLabel = patch.buttonLabel;
      if (patch.prompt !== undefined) update.prompt = patch.prompt;

      const cfg = await app.prisma.verificationConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          enabled: patch.enabled ?? false,
          channelId: patch.channelId ?? null,
          messageId: patch.messageId ?? null,
          verifiedRoleId: patch.verifiedRoleId ?? null,
          buttonLabel: patch.buttonLabel ?? null,
          prompt: patch.prompt ?? null,
        },
      });
      return {
        guildId: cfg.guildId,
        enabled: cfg.enabled,
        channelId: cfg.channelId,
        messageId: cfg.messageId,
        verifiedRoleId: cfg.verifiedRoleId,
        buttonLabel: cfg.buttonLabel,
        prompt: cfg.prompt,
      };
    },
  );
};
