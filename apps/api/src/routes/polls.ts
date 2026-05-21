import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Poll, PollOption, PollVote } from '@prisma/client';
import { z } from 'zod';
import { CreatePollSchema, SnowflakeSchema, VotePollSchema } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const PollParams = z.object({ guildId: SnowflakeSchema, pollId: z.string().uuid() });

function serializePoll(
  poll: Poll & { options: PollOption[]; votes: PollVote[] },
) {
  const voteCounts = new Map<string, number>();
  for (const v of poll.votes) voteCounts.set(v.optionId, (voteCounts.get(v.optionId) ?? 0) + 1);
  return {
    id: poll.id,
    guildId: poll.guildId,
    channelId: poll.channelId,
    messageId: poll.messageId,
    authorId: poll.authorId,
    question: poll.question,
    anonymous: poll.anonymous,
    multiSelect: poll.multiSelect,
    closesAt: poll.closesAt?.toISOString() ?? null,
    closedAt: poll.closedAt?.toISOString() ?? null,
    createdAt: poll.createdAt.toISOString(),
    options: poll.options
      .sort((a, b) => a.position - b.position)
      .map((o) => ({
        id: o.id,
        pollId: o.pollId,
        label: o.label,
        position: o.position,
        voteCount: voteCounts.get(o.id) ?? 0,
      })),
    totalVotes: poll.votes.length,
  };
}

export const pollsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/guilds/:guildId/polls',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreatePollSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const { options, ...rest } = req.body;
      const poll = await app.prisma.poll.create({
        data: {
          guildId,
          channelId: rest.channelId,
          authorId: rest.authorId,
          question: rest.question,
          anonymous: rest.anonymous ?? false,
          multiSelect: rest.multiSelect ?? false,
          closesAt: rest.closesAt ? new Date(rest.closesAt) : null,
          options: { create: options.map((label, i) => ({ label, position: i })) },
        },
        include: { options: true, votes: true },
      });
      return serializePoll(poll);
    },
  );

  app.get(
    '/guilds/:guildId/polls/:pollId',
    {
      preHandler: app.requireBot(),
      schema: { params: PollParams },
    },
    async (req) => {
      const { guildId, pollId } = req.params;
      const poll = await app.prisma.poll.findFirst({
        where: { id: pollId, guildId },
        include: { options: true, votes: true },
      });
      if (!poll) throw HttpError.notFound('Poll not found.');
      return serializePoll(poll);
    },
  );

  app.patch(
    '/guilds/:guildId/polls/:pollId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: PollParams,
        body: z.object({
          messageId: SnowflakeSchema.nullable().optional(),
          close: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const { guildId, pollId } = req.params;
      const existing = await app.prisma.poll.findFirst({ where: { id: pollId, guildId } });
      if (!existing) throw HttpError.notFound('Poll not found.');
      const update: Record<string, unknown> = {};
      if (req.body.messageId !== undefined) update.messageId = req.body.messageId;
      if (req.body.close) update.closedAt = new Date();

      await app.prisma.poll.update({ where: { id: pollId }, data: update });
      const updated = await app.prisma.poll.findUniqueOrThrow({
        where: { id: pollId },
        include: { options: true, votes: true },
      });
      return serializePoll(updated);
    },
  );

  app.post(
    '/guilds/:guildId/polls/:pollId/vote',
    {
      preHandler: app.requireBot(),
      schema: { params: PollParams, body: VotePollSchema },
    },
    async (req) => {
      const { guildId, pollId } = req.params;
      const { userId, optionIds } = req.body;
      const poll = await app.prisma.poll.findFirst({
        where: { id: pollId, guildId },
        include: { options: true },
      });
      if (!poll) throw HttpError.notFound('Poll not found.');
      if (poll.closedAt) throw HttpError.conflict('Poll is closed.');
      if (poll.closesAt && poll.closesAt < new Date()) {
        await app.prisma.poll.update({ where: { id: pollId }, data: { closedAt: new Date() } });
        throw HttpError.conflict('Poll just closed.');
      }
      if (!poll.multiSelect && optionIds.length > 1) {
        throw HttpError.badRequest('This poll only allows a single option.');
      }
      const validOptionIds = new Set(poll.options.map((o) => o.id));
      for (const id of optionIds) {
        if (!validOptionIds.has(id)) throw HttpError.badRequest(`Unknown option: ${id}`);
      }

      await app.prisma.$transaction(async (tx) => {
        await tx.pollVote.deleteMany({ where: { pollId, userId } });
        if (optionIds.length > 0) {
          await tx.pollVote.createMany({
            data: optionIds.map((optionId) => ({ pollId, optionId, userId })),
          });
        }
      });

      const refreshed = await app.prisma.poll.findUniqueOrThrow({
        where: { id: pollId },
        include: { options: true, votes: true },
      });
      return serializePoll(refreshed);
    },
  );

  // Polls due to auto-close — the bot calls this on its tick and acts on each.
  app.get(
    '/polls/due',
    {
      preHandler: app.requireBot(),
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => {
      const { limit } = req.query;
      const due = await app.prisma.poll.findMany({
        where: { closedAt: null, closesAt: { lte: new Date() } },
        include: { options: true, votes: true },
        take: limit,
      });
      return { polls: due.map(serializePoll) };
    },
  );
};
