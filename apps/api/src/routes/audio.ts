import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  SoundboardClip as PrismaSoundboardClip,
  TtsConfig as PrismaTtsConfig,
} from '@prisma/client';
import { z } from 'zod';
import {
  SnowflakeSchema,
  UpsertSoundboardClipSchema,
  UpsertTtsConfigSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const ClipParams = z.object({
  guildId: SnowflakeSchema,
  name: z.string().min(1).max(64),
});

function serializeClip(c: PrismaSoundboardClip) {
  return {
    id: c.id,
    guildId: c.guildId,
    name: c.name,
    url: c.url,
    uploaderId: c.uploaderId,
    sizeBytes: c.sizeBytes,
    createdAt: c.createdAt.toISOString(),
  };
}

function serializeTtsConfig(guildId: string, cfg: PrismaTtsConfig | null) {
  return {
    guildId,
    welcomeText: cfg?.welcomeText ?? null,
    goodbyeText: cfg?.goodbyeText ?? null,
    voiceChannelId: cfg?.voiceChannelId ?? null,
    language: cfg?.language ?? 'en',
    enabled: cfg?.enabled ?? false,
  };
}

export const audioRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Soundboard clips ────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/soundboard',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const items = await app.prisma.soundboardClip.findMany({
        where: { guildId: req.params.guildId },
        orderBy: { name: 'asc' },
      });
      return { clips: items.map(serializeClip) };
    },
  );

  app.get(
    '/guilds/:guildId/soundboard/:name',
    { preHandler: app.requireBot(), schema: { params: ClipParams } },
    async (req) => {
      const item = await app.prisma.soundboardClip.findUnique({
        where: {
          guildId_name: {
            guildId: req.params.guildId,
            name: req.params.name.toLowerCase(),
          },
        },
      });
      if (!item) throw HttpError.notFound('Clip not found.');
      return serializeClip(item);
    },
  );

  app.post(
    '/guilds/:guildId/soundboard',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertSoundboardClipSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      try {
        const created = await app.prisma.soundboardClip.create({
          data: {
            guildId,
            name: req.body.name,
            url: req.body.url,
            uploaderId: req.body.uploaderId ?? null,
            sizeBytes: req.body.sizeBytes ?? null,
          },
        });
        return serializeClip(created);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          throw HttpError.conflict('A clip with that name already exists.');
        }
        throw err;
      }
    },
  );

  app.delete(
    '/guilds/:guildId/soundboard/:name',
    { preHandler: app.requireBot(), schema: { params: ClipParams } },
    async (req, reply) => {
      const result = await app.prisma.soundboardClip.deleteMany({
        where: {
          guildId: req.params.guildId,
          name: req.params.name.toLowerCase(),
        },
      });
      if (result.count === 0) throw HttpError.notFound('Clip not found.');
      return reply.code(204).send();
    },
  );

  // ─── TTS config ──────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/tts-config',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const cfg = await app.prisma.ttsConfig.findUnique({ where: { guildId } });
      return serializeTtsConfig(guildId, cfg);
    },
  );

  app.put(
    '/guilds/:guildId/tts-config',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: UpsertTtsConfigSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const patch = req.body;

      const update: Record<string, unknown> = {};
      if (patch.welcomeText !== undefined) update.welcomeText = patch.welcomeText;
      if (patch.goodbyeText !== undefined) update.goodbyeText = patch.goodbyeText;
      if (patch.voiceChannelId !== undefined) update.voiceChannelId = patch.voiceChannelId;
      if (patch.language !== undefined) update.language = patch.language;
      if (patch.enabled !== undefined) update.enabled = patch.enabled;

      const cfg = await app.prisma.ttsConfig.upsert({
        where: { guildId },
        update,
        create: {
          guildId,
          welcomeText: patch.welcomeText ?? null,
          goodbyeText: patch.goodbyeText ?? null,
          voiceChannelId: patch.voiceChannelId ?? null,
          language: patch.language ?? 'en',
          enabled: patch.enabled ?? false,
        },
      });
      return serializeTtsConfig(guildId, cfg);
    },
  );
};
