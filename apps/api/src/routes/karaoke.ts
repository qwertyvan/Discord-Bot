import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  KaraokeNight as PrismaKaraokeNight,
  KaraokeRsvp as PrismaKaraokeRsvp,
  KaraokeSong as PrismaKaraokeSong,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateKaraokeNightSchema,
  CreateKaraokeSongSchema,
  KaraokeNightStatusSchema,
  SnowflakeSchema,
  UpdateKaraokeNightSchema,
  UpdateKaraokeSongSchema,
  UpsertKaraokeRsvpSchema,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const NightParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });
const SongParams = z.object({
  guildId: SnowflakeSchema,
  id: z.string().uuid(),
  songId: z.string().uuid(),
});

// Nights that crossed the live cutoff get auto-ended by the scheduler. Match
// the stage-event timeout so karaoke nights don't linger in "live" forever.
const LIVE_KARAOKE_MAX_AGE_MS = 4 * 3_600_000;
const T15_MS = 15 * 60_000;

function serializeSong(s: PrismaKaraokeSong) {
  return {
    id: s.id,
    nightId: s.nightId,
    submitterId: s.submitterId,
    title: s.title,
    url: s.url,
    notes: s.notes,
    playedAt: s.playedAt?.toISOString() ?? null,
    position: s.position,
    createdAt: s.createdAt.toISOString(),
  };
}

function serializeRsvp(r: PrismaKaraokeRsvp) {
  return {
    nightId: r.nightId,
    userId: r.userId,
    status: r.status as 'yes' | 'maybe' | 'no',
    rsvpAt: r.rsvpAt.toISOString(),
  };
}

function serializeNight(
  n: PrismaKaraokeNight & { songs?: PrismaKaraokeSong[]; rsvps?: PrismaKaraokeRsvp[] },
) {
  const songs = n.songs?.map(serializeSong);
  const rsvps = n.rsvps?.map(serializeRsvp);
  const counts = rsvps
    ? rsvps.reduce(
        (acc, r) => {
          acc[r.status] += 1;
          return acc;
        },
        { yes: 0, maybe: 0, no: 0 } as Record<'yes' | 'maybe' | 'no', number>,
      )
    : undefined;
  return {
    id: n.id,
    guildId: n.guildId,
    voiceChannelId: n.voiceChannelId,
    hostId: n.hostId,
    title: n.title,
    scheduledFor: n.scheduledFor.toISOString(),
    status: n.status as 'scheduled' | 'live' | 'ended' | 'cancelled',
    announceChannelId: n.announceChannelId,
    recapChannelId: n.recapChannelId,
    announcedT15: n.announcedT15,
    startedAt: n.startedAt?.toISOString() ?? null,
    endedAt: n.endedAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    ...(songs ? { songs } : {}),
    ...(rsvps ? { rsvps } : {}),
    ...(counts ? { rsvpCounts: counts } : {}),
  };
}

export const karaokeRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Due (bot-bearer) — drive the scheduler tick ───────────────────────
  app.get(
    '/karaoke-nights/due',
    {
      preHandler: app.requireBot(),
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
      },
    },
    async (req) => {
      const now = new Date();
      const t15 = new Date(now.getTime() + T15_MS);
      const liveCutoff = new Date(now.getTime() - LIVE_KARAOKE_MAX_AGE_MS);

      // Three buckets the scheduler needs to act on:
      //   1. scheduled + within T-15m + not yet T-15 announced
      //   2. scheduled + past startTime (transition to live)
      //   3. live + older than the 4h cutoff (transition to ended)
      const [t15Due, startDue, liveStale] = await Promise.all([
        app.prisma.karaokeNight.findMany({
          where: {
            status: 'scheduled',
            announcedT15: false,
            scheduledFor: { lte: t15, gt: now },
          },
          take: req.query.limit,
        }),
        app.prisma.karaokeNight.findMany({
          where: {
            status: 'scheduled',
            scheduledFor: { lte: now },
          },
          take: req.query.limit,
        }),
        app.prisma.karaokeNight.findMany({
          where: {
            status: 'live',
            OR: [
              { startedAt: { lte: liveCutoff } },
              { startedAt: null, scheduledFor: { lte: liveCutoff } },
            ],
          },
          take: req.query.limit,
        }),
      ]);

      return {
        t15: t15Due.map(serializeNight),
        starting: startDue.map(serializeNight),
        endingLive: liveStale.map(serializeNight),
      };
    },
  );

  // ─── List ───────────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/karaoke-nights',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          status: KaraokeNightStatusSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
      },
    },
    async (req) => {
      const items = await app.prisma.karaokeNight.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        orderBy: { scheduledFor: 'asc' },
        take: req.query.limit,
      });
      return { nights: items.map(serializeNight) };
    },
  );

  app.get(
    '/guilds/:guildId/karaoke-nights/:id',
    { preHandler: app.requireBot(), schema: { params: NightParams } },
    async (req) => {
      const item = await app.prisma.karaokeNight.findFirst({
        where: { id: req.params.id, guildId: req.params.guildId },
        include: {
          songs: { orderBy: { position: 'asc' } },
          rsvps: true,
        },
      });
      if (!item) throw HttpError.notFound('Karaoke night not found.');
      return serializeNight(item);
    },
  );

  app.post(
    '/guilds/:guildId/karaoke-nights',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateKaraokeNightSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const n = await app.prisma.karaokeNight.create({
        data: {
          guildId,
          voiceChannelId: req.body.voiceChannelId,
          hostId: req.body.hostId,
          title: req.body.title,
          scheduledFor: new Date(req.body.scheduledFor),
          announceChannelId: req.body.announceChannelId ?? null,
          recapChannelId: req.body.recapChannelId ?? null,
        },
      });
      return serializeNight(n);
    },
  );

  app.patch(
    '/guilds/:guildId/karaoke-nights/:id',
    {
      preHandler: app.requireBot(),
      schema: { params: NightParams, body: UpdateKaraokeNightSchema },
    },
    async (req) => {
      const existing = await app.prisma.karaokeNight.findFirst({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (!existing) throw HttpError.notFound('Karaoke night not found.');

      const patch = req.body;
      const data: Record<string, unknown> = {};
      if (patch.title !== undefined) data['title'] = patch.title;
      if (patch.scheduledFor !== undefined) data['scheduledFor'] = new Date(patch.scheduledFor);
      if (patch.voiceChannelId !== undefined) data['voiceChannelId'] = patch.voiceChannelId;
      if (patch.hostId !== undefined) data['hostId'] = patch.hostId;
      if (patch.announceChannelId !== undefined) data['announceChannelId'] = patch.announceChannelId;
      if (patch.recapChannelId !== undefined) data['recapChannelId'] = patch.recapChannelId;
      if (patch.announcedT15 !== undefined) data['announcedT15'] = patch.announcedT15;
      if (patch.status !== undefined) {
        data['status'] = patch.status;
        if (patch.status === 'live' && !existing.startedAt) data['startedAt'] = new Date();
        if ((patch.status === 'ended' || patch.status === 'cancelled') && !existing.endedAt) {
          data['endedAt'] = new Date();
        }
      }

      const updated = await app.prisma.karaokeNight.update({
        where: { id: req.params.id },
        data,
        include: {
          songs: { orderBy: { position: 'asc' } },
          rsvps: true,
        },
      });
      return serializeNight(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/karaoke-nights/:id',
    { preHandler: app.requireBot(), schema: { params: NightParams } },
    async (req, reply) => {
      const result = await app.prisma.karaokeNight.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Karaoke night not found.');
      return reply.code(204).send();
    },
  );

  // ─── Songs ─────────────────────────────────────────────────────────────
  app.post(
    '/guilds/:guildId/karaoke-nights/:id/songs',
    {
      preHandler: app.requireBot(),
      schema: { params: NightParams, body: CreateKaraokeSongSchema },
    },
    async (req) => {
      const night = await app.prisma.karaokeNight.findFirst({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (!night) throw HttpError.notFound('Karaoke night not found.');
      if (night.status === 'ended' || night.status === 'cancelled') {
        throw HttpError.conflict('This karaoke night is no longer accepting songs.');
      }

      // Append to the end of the queue. The position counter is monotonic per
      // night — playedAt + position together let the host order the lineup.
      const last = await app.prisma.karaokeSong.findFirst({
        where: { nightId: night.id },
        orderBy: { position: 'desc' },
      });
      const nextPos = (last?.position ?? -1) + 1;

      const song = await app.prisma.karaokeSong.create({
        data: {
          nightId: night.id,
          submitterId: req.body.submitterId,
          title: req.body.title,
          url: req.body.url ?? null,
          notes: req.body.notes ?? null,
          position: nextPos,
        },
      });
      return serializeSong(song);
    },
  );

  app.patch(
    '/guilds/:guildId/karaoke-nights/:id/songs/:songId',
    {
      preHandler: app.requireBot(),
      schema: { params: SongParams, body: UpdateKaraokeSongSchema },
    },
    async (req) => {
      const song = await app.prisma.karaokeSong.findFirst({
        where: { id: req.params.songId, nightId: req.params.id },
      });
      if (!song) throw HttpError.notFound('Song not found.');

      const data: Record<string, unknown> = {};
      if (req.body.title !== undefined) data['title'] = req.body.title;
      if (req.body.url !== undefined) data['url'] = req.body.url;
      if (req.body.notes !== undefined) data['notes'] = req.body.notes;
      if (req.body.position !== undefined) data['position'] = req.body.position;
      if (req.body.played !== undefined) {
        data['playedAt'] = req.body.played ? new Date() : null;
      }
      const updated = await app.prisma.karaokeSong.update({
        where: { id: song.id },
        data,
      });
      return serializeSong(updated);
    },
  );

  app.delete(
    '/guilds/:guildId/karaoke-nights/:id/songs/:songId',
    { preHandler: app.requireBot(), schema: { params: SongParams } },
    async (req, reply) => {
      const result = await app.prisma.karaokeSong.deleteMany({
        where: { id: req.params.songId, nightId: req.params.id },
      });
      if (result.count === 0) throw HttpError.notFound('Song not found.');
      return reply.code(204).send();
    },
  );

  // ─── RSVP ──────────────────────────────────────────────────────────────
  app.post(
    '/guilds/:guildId/karaoke-nights/:id/rsvp',
    {
      preHandler: app.requireBot(),
      schema: { params: NightParams, body: UpsertKaraokeRsvpSchema },
    },
    async (req) => {
      const night = await app.prisma.karaokeNight.findFirst({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (!night) throw HttpError.notFound('Karaoke night not found.');

      await app.prisma.karaokeRsvp.upsert({
        where: { nightId_userId: { nightId: night.id, userId: req.body.userId } },
        update: { status: req.body.status, rsvpAt: new Date() },
        create: { nightId: night.id, userId: req.body.userId, status: req.body.status },
      });
      const refreshed = await app.prisma.karaokeNight.findUniqueOrThrow({
        where: { id: night.id },
        include: {
          songs: { orderBy: { position: 'asc' } },
          rsvps: true,
        },
      });
      return serializeNight(refreshed);
    },
  );
};
