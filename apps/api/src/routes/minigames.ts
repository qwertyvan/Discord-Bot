import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  TriviaQuestion as PrismaTriviaQuestion,
  TriviaScore as PrismaTriviaScore,
  HangmanGame as PrismaHangmanGame,
  RpsRecord as PrismaRpsRecord,
  RpsChallenge as PrismaRpsChallenge,
  DailyStreak as PrismaDailyStreak,
} from '@prisma/client';
import { z } from 'zod';
import {
  CreateTriviaQuestionSchema,
  IncrementTriviaScoreSchema,
  CreateHangmanGameSchema,
  UpdateHangmanGameSchema,
  CreateRpsChallengeSchema,
  RespondRpsChallengeSchema,
  SnowflakeSchema,
  type RpsChoice,
  type RpsResult,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const TriviaParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });
const HangmanIdParams = z.object({ id: z.string().uuid() });
const RpsUserParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });
const RpsChallengeParams = z.object({ id: z.string().uuid() });

function serializeTrivia(q: PrismaTriviaQuestion) {
  return {
    id: q.id,
    guildId: q.guildId,
    prompt: q.prompt,
    choices: q.choices,
    correctIndex: q.correctIndex,
    category: q.category,
    createdBy: q.createdBy,
    createdAt: q.createdAt.toISOString(),
  };
}

function serializeTriviaScore(
  s: PrismaTriviaScore | null,
  guildId: string,
  userId: string,
) {
  return {
    guildId,
    userId,
    correct: s?.correct ?? 0,
    total: s?.total ?? 0,
  };
}

function serializeHangman(g: PrismaHangmanGame) {
  return {
    id: g.id,
    guildId: g.guildId,
    channelId: g.channelId,
    hostId: g.hostId,
    word: g.word,
    revealed: g.revealed,
    misses: g.misses,
    maxMisses: g.maxMisses,
    messageId: g.messageId,
    status: g.status as 'active' | 'won' | 'lost' | 'abandoned',
    createdAt: g.createdAt.toISOString(),
  };
}

function serializeRpsRecord(
  r: PrismaRpsRecord | null,
  guildId: string,
  userId: string,
) {
  return {
    guildId,
    userId,
    wins: r?.wins ?? 0,
    losses: r?.losses ?? 0,
    draws: r?.draws ?? 0,
    elo: r?.elo ?? 1000,
  };
}

function serializeRpsChallenge(c: PrismaRpsChallenge) {
  return {
    id: c.id,
    guildId: c.guildId,
    channelId: c.channelId,
    challengerId: c.challengerId,
    opponentId: c.opponentId,
    challengerChoice: (c.challengerChoice as RpsChoice | null) ?? null,
    opponentChoice: (c.opponentChoice as RpsChoice | null) ?? null,
    status: c.status as 'open' | 'resolved' | 'cancelled',
    createdAt: c.createdAt.toISOString(),
  };
}

function serializeDailyStreak(
  s: PrismaDailyStreak | null,
  guildId: string,
  userId: string,
) {
  return {
    guildId,
    userId,
    streak: s?.streak ?? 0,
    lastClaimAt: s?.lastClaimAt?.toISOString() ?? null,
  };
}

// Render a word as `_ _ _` with revealed letters and spaces preserved.
function maskWord(word: string, revealedLetters: Set<string>): string {
  return [...word.toUpperCase()]
    .map((ch) => {
      if (ch === ' ') return ' ';
      return revealedLetters.has(ch) ? ch : '_';
    })
    .join('');
}

function rpsOutcome(challenger: RpsChoice, opponent: RpsChoice): RpsResult {
  if (challenger === opponent) return 'draw';
  if (
    (challenger === 'rock' && opponent === 'scissors') ||
    (challenger === 'paper' && opponent === 'rock') ||
    (challenger === 'scissors' && opponent === 'paper')
  ) {
    return 'challenger';
  }
  return 'opponent';
}

// Simple ELO update. K=32. Score = 1 win / 0.5 draw / 0 loss.
function eloDelta(playerElo: number, opponentElo: number, score: number): number {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  return Math.round(32 * (score - expected));
}

// UTC day key (YYYY-MM-DD).
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const minigamesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Trivia: questions ───────────────────────────────────────────
  app.get(
    '/guilds/:guildId/trivia',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          category: z.string().min(1).max(64).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
      },
    },
    async (req) => {
      const items = await app.prisma.triviaQuestion.findMany({
        where: {
          guildId: req.params.guildId,
          ...(req.query.category ? { category: req.query.category } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return { questions: items.map(serializeTrivia) };
    },
  );

  app.get(
    '/guilds/:guildId/trivia/random',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          category: z.string().min(1).max(64).optional(),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const where = {
        guildId,
        ...(req.query.category ? { category: req.query.category } : {}),
      };
      const total = await app.prisma.triviaQuestion.count({ where });
      if (total === 0) throw HttpError.notFound('No trivia questions match.');
      const skip = Math.floor(Math.random() * total);
      const [item] = await app.prisma.triviaQuestion.findMany({ where, skip, take: 1 });
      if (!item) throw HttpError.notFound('No trivia questions match.');
      return serializeTrivia(item);
    },
  );

  app.post(
    '/guilds/:guildId/trivia',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateTriviaQuestionSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const created = await app.prisma.triviaQuestion.create({
        data: {
          guildId,
          prompt: req.body.prompt,
          choices: req.body.choices,
          correctIndex: req.body.correctIndex,
          category: req.body.category ?? null,
          createdBy: req.body.createdBy,
        },
      });
      return serializeTrivia(created);
    },
  );

  app.delete(
    '/guilds/:guildId/trivia/:id',
    { preHandler: app.requireBot(), schema: { params: TriviaParams } },
    async (req, reply) => {
      const result = await app.prisma.triviaQuestion.deleteMany({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (result.count === 0) throw HttpError.notFound('Trivia question not found.');
      return reply.code(204).send();
    },
  );

  // ─── Trivia: scores ──────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/trivia-scores',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(10),
        }),
      },
    },
    async (req) => {
      const scores = await app.prisma.triviaScore.findMany({
        where: { guildId: req.params.guildId },
        orderBy: [{ correct: 'desc' }, { total: 'asc' }],
        take: req.query.limit,
      });
      return {
        scores: scores.map((s) => serializeTriviaScore(s, s.guildId, s.userId)),
      };
    },
  );

  app.post(
    '/guilds/:guildId/trivia-score/increment',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: IncrementTriviaScoreSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const { userId, correct } = req.body;
      const updated = await app.prisma.triviaScore.upsert({
        where: { guildId_userId: { guildId, userId } },
        update: {
          total: { increment: 1 },
          ...(correct ? { correct: { increment: 1 } } : {}),
        },
        create: {
          guildId,
          userId,
          total: 1,
          correct: correct ? 1 : 0,
        },
      });
      return serializeTriviaScore(updated, guildId, userId);
    },
  );

  // ─── Hangman ─────────────────────────────────────────────────────
  app.post(
    '/guilds/:guildId/hangman',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateHangmanGameSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      // Disallow more than one active hangman per channel.
      const existing = await app.prisma.hangmanGame.findFirst({
        where: { channelId: req.body.channelId, status: 'active' },
      });
      if (existing) {
        throw HttpError.conflict('A hangman game is already active in this channel.');
      }
      const word = req.body.word.toUpperCase();
      const revealed = maskWord(word, new Set());
      const created = await app.prisma.hangmanGame.create({
        data: {
          guildId,
          channelId: req.body.channelId,
          hostId: req.body.hostId,
          word,
          revealed,
          misses: '',
          maxMisses: req.body.maxMisses ?? 6,
        },
      });
      return serializeHangman(created);
    },
  );

  app.get(
    '/hangman/:id',
    { preHandler: app.requireBot(), schema: { params: HangmanIdParams } },
    async (req) => {
      const item = await app.prisma.hangmanGame.findUnique({
        where: { id: req.params.id },
      });
      if (!item) throw HttpError.notFound('Hangman game not found.');
      return serializeHangman(item);
    },
  );

  app.patch(
    '/hangman/:id',
    {
      preHandler: app.requireBot(),
      schema: { params: HangmanIdParams, body: UpdateHangmanGameSchema },
    },
    async (req) => {
      const updated = await app.prisma.hangmanGame.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.revealed !== undefined ? { revealed: req.body.revealed } : {}),
          ...(req.body.misses !== undefined ? { misses: req.body.misses } : {}),
          ...(req.body.status !== undefined ? { status: req.body.status } : {}),
          ...(req.body.messageId !== undefined ? { messageId: req.body.messageId } : {}),
        },
      });
      return serializeHangman(updated);
    },
  );

  // ─── RPS ─────────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/rps-record/:userId',
    { preHandler: app.requireBot(), schema: { params: RpsUserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const rec = await app.prisma.rpsRecord.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      return serializeRpsRecord(rec, guildId, userId);
    },
  );

  app.post(
    '/guilds/:guildId/rps-challenges',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateRpsChallengeSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      if (req.body.challengerId === req.body.opponentId) {
        throw HttpError.badRequest('You cannot challenge yourself.');
      }
      const created = await app.prisma.rpsChallenge.create({
        data: {
          guildId,
          channelId: req.body.channelId,
          challengerId: req.body.challengerId,
          opponentId: req.body.opponentId,
          challengerChoice: req.body.challengerChoice,
        },
      });
      return serializeRpsChallenge(created);
    },
  );

  app.post(
    '/rps-challenges/:id/respond',
    {
      preHandler: app.requireBot(),
      schema: { params: RpsChallengeParams, body: RespondRpsChallengeSchema },
    },
    async (req) => {
      const { id } = req.params;
      const existing = await app.prisma.rpsChallenge.findUnique({ where: { id } });
      if (!existing) throw HttpError.notFound('RPS challenge not found.');
      if (existing.status !== 'open') {
        throw HttpError.conflict('This challenge is no longer open.');
      }
      if (existing.opponentId !== req.body.opponentId) {
        throw HttpError.forbidden('You are not the challenged opponent.');
      }
      if (!existing.challengerChoice) {
        throw HttpError.conflict('Challenger has not yet chosen.');
      }

      const result = rpsOutcome(
        existing.challengerChoice as RpsChoice,
        req.body.opponentChoice,
      );

      const challengerRec = await app.prisma.rpsRecord.findUnique({
        where: {
          guildId_userId: { guildId: existing.guildId, userId: existing.challengerId },
        },
      });
      const opponentRec = await app.prisma.rpsRecord.findUnique({
        where: {
          guildId_userId: { guildId: existing.guildId, userId: existing.opponentId },
        },
      });
      const challengerElo = challengerRec?.elo ?? 1000;
      const opponentElo = opponentRec?.elo ?? 1000;

      let challengerScore: number;
      let opponentScore: number;
      if (result === 'challenger') {
        challengerScore = 1;
        opponentScore = 0;
      } else if (result === 'opponent') {
        challengerScore = 0;
        opponentScore = 1;
      } else {
        challengerScore = 0.5;
        opponentScore = 0.5;
      }
      const challengerDelta = eloDelta(challengerElo, opponentElo, challengerScore);
      const opponentDelta = eloDelta(opponentElo, challengerElo, opponentScore);

      const [challenge, challengerRecord, opponentRecord] = await app.prisma.$transaction([
        app.prisma.rpsChallenge.update({
          where: { id },
          data: {
            opponentChoice: req.body.opponentChoice,
            status: 'resolved',
          },
        }),
        app.prisma.rpsRecord.upsert({
          where: {
            guildId_userId: { guildId: existing.guildId, userId: existing.challengerId },
          },
          update: {
            wins: { increment: result === 'challenger' ? 1 : 0 },
            losses: { increment: result === 'opponent' ? 1 : 0 },
            draws: { increment: result === 'draw' ? 1 : 0 },
            elo: { increment: challengerDelta },
          },
          create: {
            guildId: existing.guildId,
            userId: existing.challengerId,
            wins: result === 'challenger' ? 1 : 0,
            losses: result === 'opponent' ? 1 : 0,
            draws: result === 'draw' ? 1 : 0,
            elo: 1000 + challengerDelta,
          },
        }),
        app.prisma.rpsRecord.upsert({
          where: {
            guildId_userId: { guildId: existing.guildId, userId: existing.opponentId },
          },
          update: {
            wins: { increment: result === 'opponent' ? 1 : 0 },
            losses: { increment: result === 'challenger' ? 1 : 0 },
            draws: { increment: result === 'draw' ? 1 : 0 },
            elo: { increment: opponentDelta },
          },
          create: {
            guildId: existing.guildId,
            userId: existing.opponentId,
            wins: result === 'opponent' ? 1 : 0,
            losses: result === 'challenger' ? 1 : 0,
            draws: result === 'draw' ? 1 : 0,
            elo: 1000 + opponentDelta,
          },
        }),
      ]);

      return {
        challenge: serializeRpsChallenge(challenge),
        result,
        challengerRecord: serializeRpsRecord(
          challengerRecord,
          existing.guildId,
          existing.challengerId,
        ),
        opponentRecord: serializeRpsRecord(
          opponentRecord,
          existing.guildId,
          existing.opponentId,
        ),
        challengerEloDelta: challengerDelta,
        opponentEloDelta: opponentDelta,
      };
    },
  );

  // ─── Daily streak ────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/daily/:userId',
    { preHandler: app.requireBot(), schema: { params: RpsUserParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const s = await app.prisma.dailyStreak.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      return serializeDailyStreak(s, guildId, userId);
    },
  );

  app.post(
    '/guilds/:guildId/daily/claim',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        body: z.object({ userId: SnowflakeSchema }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId } = req.body;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');

      const now = new Date();
      const today = utcDayKey(now);
      const existing = await app.prisma.dailyStreak.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });

      if (existing?.lastClaimAt) {
        const last = utcDayKey(existing.lastClaimAt);
        if (last === today) {
          return {
            streak: serializeDailyStreak(existing, guildId, userId),
            rewardCurrency: 0,
            alreadyClaimed: true,
          };
        }
        // Streak continues if the previous claim was yesterday UTC.
        const yesterday = utcDayKey(new Date(now.getTime() - 86_400_000));
        const nextStreak = last === yesterday ? existing.streak + 1 : 1;
        const updated = await app.prisma.dailyStreak.update({
          where: { guildId_userId: { guildId, userId } },
          data: { streak: nextStreak, lastClaimAt: now },
        });

        // If economy enabled, also award currency.
        let reward = 0;
        const econ = await app.prisma.economyConfig.findUnique({ where: { guildId } });
        if (econ?.enabled) {
          reward = econ.dailyReward;
          await app.prisma.balance.upsert({
            where: { guildId_userId: { guildId, userId } },
            update: { amount: { increment: reward } },
            create: { guildId, userId, amount: econ.startingBalance + reward },
          });
        }
        return {
          streak: serializeDailyStreak(updated, guildId, userId),
          rewardCurrency: reward,
          alreadyClaimed: false,
        };
      }

      // First-ever claim.
      const created = await app.prisma.dailyStreak.upsert({
        where: { guildId_userId: { guildId, userId } },
        update: { streak: 1, lastClaimAt: now },
        create: { guildId, userId, streak: 1, lastClaimAt: now },
      });
      let reward = 0;
      const econ = await app.prisma.economyConfig.findUnique({ where: { guildId } });
      if (econ?.enabled) {
        reward = econ.dailyReward;
        await app.prisma.balance.upsert({
          where: { guildId_userId: { guildId, userId } },
          update: { amount: { increment: reward } },
          create: { guildId, userId, amount: econ.startingBalance + reward },
        });
      }
      return {
        streak: serializeDailyStreak(created, guildId, userId),
        rewardCurrency: reward,
        alreadyClaimed: false,
      };
    },
  );
};
