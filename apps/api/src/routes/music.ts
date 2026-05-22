import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  MusicQueue as PrismaMusicQueue,
  MusicTrack as PrismaMusicTrack,
} from '@prisma/client';
import { z } from 'zod';
import {
  AddTrackSchema,
  LoopModeSchema,
  MoveTrackSchema,
  SetQueueStateSchema,
  SnowflakeSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const TrackParams = z.object({ guildId: SnowflakeSchema, trackId: z.string().uuid() });

type LoopMode = 'off' | 'track' | 'queue';

function serializeTrack(t: PrismaMusicTrack) {
  return {
    id: t.id,
    guildId: t.guildId,
    position: t.position,
    title: t.title,
    url: t.url,
    durationSec: t.durationSec,
    requesterId: t.requesterId,
    addedAt: t.addedAt.toISOString(),
  };
}

function serializeQueue(
  q: PrismaMusicQueue,
  tracks: PrismaMusicTrack[],
) {
  return {
    guildId: q.guildId,
    channelId: q.channelId,
    currentIndex: q.currentIndex,
    volume: q.volume,
    loopMode: q.loopMode as LoopMode,
    updatedAt: q.updatedAt.toISOString(),
    tracks: tracks.map(serializeTrack),
  };
}

export const musicRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Queue ───────────────────────────────────────────────────────────
  // GET /guilds/:guildId/music — get the queue (creating it lazily so the
  // bot doesn't have to special-case "no queue yet").
  app.get(
    '/guilds/:guildId/music',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const queue = await app.prisma.musicQueue.upsert({
        where: { guildId },
        update: {},
        create: { guildId },
      });
      const tracks = await app.prisma.musicTrack.findMany({
        where: { guildId },
        orderBy: { position: 'asc' },
      });
      return serializeQueue(queue, tracks);
    },
  );

  // PATCH /guilds/:guildId/music — set volume / loop / current index /
  // channelId; pass `shuffle: true` to randomize the tracks after currentIndex.
  app.patch(
    '/guilds/:guildId/music',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: SetQueueStateSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      await app.prisma.musicQueue.upsert({
        where: { guildId },
        update: {},
        create: { guildId },
      });

      const data: {
        channelId?: string | null;
        currentIndex?: number;
        volume?: number;
        loopMode?: LoopMode;
      } = {};
      if (req.body.channelId !== undefined) data.channelId = req.body.channelId;
      if (req.body.currentIndex !== undefined) data.currentIndex = req.body.currentIndex;
      if (req.body.volume !== undefined) data.volume = req.body.volume;
      if (req.body.loopMode !== undefined) data.loopMode = req.body.loopMode;

      const updated = await app.prisma.musicQueue.update({
        where: { guildId },
        data,
      });

      if (req.body.shuffle) {
        // Shuffle the tracks strictly after currentIndex so the currently-
        // playing track stays put. We renumber positions to keep them dense.
        const tracks = await app.prisma.musicTrack.findMany({
          where: { guildId },
          orderBy: { position: 'asc' },
        });
        const head = tracks.slice(0, updated.currentIndex + 1);
        const tail = tracks.slice(updated.currentIndex + 1);
        for (let i = tail.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const a = tail[i]!;
          const b = tail[j]!;
          tail[i] = b;
          tail[j] = a;
        }
        const ordered = [...head, ...tail];
        await app.prisma.$transaction(
          ordered.map((t, idx) =>
            app.prisma.musicTrack.update({
              where: { id: t.id },
              data: { position: idx },
            }),
          ),
        );
      }

      const tracks = await app.prisma.musicTrack.findMany({
        where: { guildId },
        orderBy: { position: 'asc' },
      });
      const refreshed = await app.prisma.musicQueue.findUniqueOrThrow({ where: { guildId } });
      return serializeQueue(refreshed, tracks);
    },
  );

  // DELETE /guilds/:guildId/music/tracks — clear all tracks and reset
  // currentIndex; preserves volume/loopMode/channelId.
  app.delete(
    '/guilds/:guildId/music/tracks',
    { preHandler: app.requireBot(), schema: { params: GuildParams } },
    async (req) => {
      const { guildId } = req.params;
      await app.prisma.musicTrack.deleteMany({ where: { guildId } });
      const queue = await app.prisma.musicQueue.upsert({
        where: { guildId },
        update: { currentIndex: 0 },
        create: { guildId },
      });
      return serializeQueue(queue, []);
    },
  );

  // ─── Tracks ──────────────────────────────────────────────────────────
  // POST /guilds/:guildId/music/tracks — append a track to the queue.
  app.post(
    '/guilds/:guildId/music/tracks',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: AddTrackSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      await app.prisma.musicQueue.upsert({
        where: { guildId },
        update: {},
        create: { guildId },
      });
      const max = await app.prisma.musicTrack.aggregate({
        where: { guildId },
        _max: { position: true },
      });
      const nextPosition = (max._max.position ?? -1) + 1;
      const created = await app.prisma.musicTrack.create({
        data: {
          guildId,
          position: nextPosition,
          title: req.body.title,
          url: req.body.url,
          durationSec: req.body.durationSec ?? null,
          requesterId: req.body.requesterId,
        },
      });
      return serializeTrack(created);
    },
  );

  app.delete(
    '/guilds/:guildId/music/tracks/:trackId',
    { preHandler: app.requireBot(), schema: { params: TrackParams } },
    async (req, reply) => {
      const { guildId, trackId } = req.params;
      const existing = await app.prisma.musicTrack.findFirst({
        where: { id: trackId, guildId },
      });
      if (!existing) throw HttpError.notFound('Track not found.');
      await app.prisma.musicTrack.delete({ where: { id: trackId } });
      // Renumber remaining tracks so positions stay dense.
      const remaining = await app.prisma.musicTrack.findMany({
        where: { guildId },
        orderBy: { position: 'asc' },
      });
      await app.prisma.$transaction(
        remaining.map((t, idx) =>
          app.prisma.musicTrack.update({
            where: { id: t.id },
            data: { position: idx },
          }),
        ),
      );
      return reply.code(204).send();
    },
  );

  // POST /guilds/:guildId/music/tracks/move — reorder by absolute position.
  app.post(
    '/guilds/:guildId/music/tracks/move',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: MoveTrackSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { fromPosition, toPosition } = req.body;
      const tracks = await app.prisma.musicTrack.findMany({
        where: { guildId },
        orderBy: { position: 'asc' },
      });
      if (fromPosition >= tracks.length || toPosition >= tracks.length) {
        throw HttpError.badRequest('Position out of range.');
      }
      const moved = tracks[fromPosition]!;
      const without = tracks.filter((_, i) => i !== fromPosition);
      without.splice(toPosition, 0, moved);
      await app.prisma.$transaction(
        without.map((t, idx) =>
          app.prisma.musicTrack.update({
            where: { id: t.id },
            data: { position: idx },
          }),
        ),
      );
      const refreshed = await app.prisma.musicTrack.findMany({
        where: { guildId },
        orderBy: { position: 'asc' },
      });
      return { tracks: refreshed.map(serializeTrack) };
    },
  );
};

// Re-exported for tests / mocks.
export { LoopModeSchema };
