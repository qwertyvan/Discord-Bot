import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type {
  BattlePet as PrismaBattlePet,
  DuelMatch as PrismaDuelMatch,
} from '@prisma/client';
import { z } from 'zod';
import {
  AllocateStatsSchema,
  CreateDuelSchema,
  DuelLogEntrySchema,
  RespondDuelSchema,
  SnowflakeSchema,
  SubmitDuelMoveSchema,
  UpsertBattlePetNameSchema,
  type DuelLogEntry,
  type DuelMove,
  type DuelStatus,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';

const GuildParams = z.object({ guildId: SnowflakeSchema });
const PetParams = z.object({ guildId: SnowflakeSchema, userId: SnowflakeSchema });
const DuelParams = z.object({ guildId: SnowflakeSchema, id: z.string().uuid() });

// XP awarded to the winner per duel. The loser banks a small consolation.
const XP_WIN = 50;
const XP_LOSS = 15;
const XP_DRAW = 25;
// Each level requires this many XP × current level.
const XP_PER_LEVEL = 100;
// Stat points awarded per level-up.
const POINTS_PER_LEVEL = 3;
// Currency reward to the winner when the guild's economy is enabled.
const CURRENCY_REWARD = 25;

// Damage formula constants. `attack` deals atk - opponent.def (min 1) with a
// crit chance modulated by speed; `defend` halves incoming damage on the next
// hit; `special` costs ⌈maxHp/3⌉ self-damage and deals atk × 1.5 (rounded).
const BASE_CRIT_CHANCE = 0.05;
const CRIT_SPD_FACTOR = 0.005;
const CRIT_DAMAGE_MULTIPLIER = 1.75;
const SPECIAL_DAMAGE_MULTIPLIER = 1.5;

const ELO_K = 32;

function eloExpected(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

function eloDelta(playerElo: number, opponentElo: number, score: number): number {
  return Math.round(ELO_K * (score - eloExpected(playerElo, opponentElo)));
}

// Replay the log to compute live HP for each side. Cheap (≤ 100 turns max).
function replayHp(
  challengerMaxHp: number,
  opponentMaxHp: number,
  log: DuelLogEntry[],
): { challengerHp: number; opponentHp: number } {
  if (log.length === 0) {
    return { challengerHp: challengerMaxHp, opponentHp: opponentMaxHp };
  }
  const last = log[log.length - 1]!;
  return { challengerHp: last.challengerHp, opponentHp: last.opponentHp };
}

// Walk the log backwards looking for each side's most-recent `defend` whose
// effect hasn't been spent. A defender's posture is consumed the next time
// they're targeted by an `attack`/`special`.
function defendingState(
  log: DuelLogEntry[],
  challengerId: string,
  opponentId: string,
): { challengerDefending: boolean; opponentDefending: boolean } {
  let challengerDefending: boolean | null = null;
  let opponentDefending: boolean | null = null;
  let challengerWasTargeted = false;
  let opponentWasTargeted = false;
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]!;
    // Targeting: an attack/special by the OTHER side counts as a target.
    if (entry.move === 'attack' || entry.move === 'special') {
      if (entry.actorId === challengerId) opponentWasTargeted = true;
      else if (entry.actorId === opponentId) challengerWasTargeted = true;
    }
    if (
      challengerDefending === null &&
      entry.actorId === challengerId &&
      entry.move === 'defend'
    ) {
      challengerDefending = !challengerWasTargeted;
    }
    if (
      opponentDefending === null &&
      entry.actorId === opponentId &&
      entry.move === 'defend'
    ) {
      opponentDefending = !opponentWasTargeted;
    }
    if (challengerDefending !== null && opponentDefending !== null) break;
  }
  return {
    challengerDefending: challengerDefending ?? false,
    opponentDefending: opponentDefending ?? false,
  };
}

function serializePet(p: PrismaBattlePet) {
  return {
    guildId: p.guildId,
    userId: p.userId,
    name: p.name,
    species: p.species,
    level: p.level,
    xp: p.xp,
    hp: p.hp,
    maxHp: p.maxHp,
    atk: p.atk,
    def: p.def,
    spd: p.spd,
    allocPoints: p.allocPoints,
    wins: p.wins,
    losses: p.losses,
    draws: p.draws,
    elo: p.elo,
    createdAt: p.createdAt.toISOString(),
  };
}

function serializeMatch(
  m: PrismaDuelMatch,
  challengerMaxHp: number,
  opponentMaxHp: number,
) {
  const log = (Array.isArray(m.log) ? (m.log as unknown[]) : [])
    .map((e) => DuelLogEntrySchema.safeParse(e))
    .filter((r): r is Extract<typeof r, { success: true }> => r.success)
    .map((r) => r.data);
  const { challengerHp, opponentHp } = replayHp(
    challengerMaxHp,
    opponentMaxHp,
    log,
  );
  const { challengerDefending, opponentDefending } = defendingState(
    log,
    m.challengerId,
    m.opponentId,
  );
  return {
    id: m.id,
    guildId: m.guildId,
    challengerId: m.challengerId,
    opponentId: m.opponentId,
    status: m.status as DuelStatus,
    turn: m.turn,
    currentActorId: m.currentActorId,
    log,
    winnerId: m.winnerId,
    challengerHp,
    opponentHp,
    challengerDefending,
    opponentDefending,
    createdAt: m.createdAt.toISOString(),
    endedAt: m.endedAt?.toISOString() ?? null,
  };
}

function xpToNextLevel(level: number): number {
  return XP_PER_LEVEL * level;
}

// Apply XP + level-up to a pet (mutating returned object). Each level grants
// POINTS_PER_LEVEL allocation points to spend later, plus a small auto-bump
// to maxHp so unspent points don't leave low-level pets one-shot territory.
function applyXp(pet: PrismaBattlePet, gainedXp: number): {
  level: number;
  xp: number;
  maxHp: number;
  allocPoints: number;
  leveledUp: boolean;
} {
  let level = pet.level;
  let xp = pet.xp + gainedXp;
  let maxHp = pet.maxHp;
  let allocPoints = pet.allocPoints;
  let leveledUp = false;
  while (xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level);
    level += 1;
    allocPoints += POINTS_PER_LEVEL;
    maxHp += 5;
    leveledUp = true;
  }
  return { level, xp, maxHp, allocPoints, leveledUp };
}

// Resolve a single move against the current state. Returns the new log entry
// + post-move HP totals (for whichever side took damage).
function resolveMove(args: {
  move: DuelMove;
  actorIsChallenger: boolean;
  actor: PrismaBattlePet;
  defender: PrismaBattlePet;
  challengerHp: number;
  opponentHp: number;
  defenderDefending: boolean;
  turn: number;
}): DuelLogEntry {
  const {
    move,
    actorIsChallenger,
    actor,
    defender,
    defenderDefending,
    turn,
  } = args;
  let challengerHp = args.challengerHp;
  let opponentHp = args.opponentHp;
  let damage = 0;
  let crit = false;
  let note: string | undefined;

  if (move === 'defend') {
    note = `${actor.name} braces for impact.`;
  } else {
    // Compute crit chance based on actor's speed differential.
    const spdDelta = actor.spd - defender.spd;
    const critChance = Math.min(
      0.5,
      Math.max(0.01, BASE_CRIT_CHANCE + spdDelta * CRIT_SPD_FACTOR),
    );
    crit = Math.random() < critChance;

    let raw: number;
    if (move === 'attack') {
      raw = actor.atk - defender.def;
    } else {
      // special — costs the actor a chunk of HP, deals atk × 1.5.
      const selfCost = Math.max(1, Math.ceil(actor.maxHp / 3));
      if (actorIsChallenger) {
        challengerHp = Math.max(0, challengerHp - selfCost);
      } else {
        opponentHp = Math.max(0, opponentHp - selfCost);
      }
      raw = Math.round(actor.atk * SPECIAL_DAMAGE_MULTIPLIER) - defender.def;
      note = `${actor.name} unleashes a special! (-${selfCost} HP cost)`;
    }
    if (crit) raw = Math.round(raw * CRIT_DAMAGE_MULTIPLIER);
    if (defenderDefending) raw = Math.ceil(raw / 2);
    damage = Math.max(1, raw);
    if (actorIsChallenger) {
      opponentHp = Math.max(0, opponentHp - damage);
    } else {
      challengerHp = Math.max(0, challengerHp - damage);
    }
  }

  const entry: DuelLogEntry = {
    turn,
    actorId: actor.userId,
    move,
    damage,
    challengerHp,
    opponentHp,
    ...(crit ? { crit: true } : {}),
    ...(note ? { note } : {}),
  };
  return entry;
}

export const duelsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ─── Battle pets ────────────────────────────────────────────────────
  app.get(
    '/guilds/:guildId/battle-pets/:userId',
    { preHandler: app.requireBot(), schema: { params: PetParams } },
    async (req) => {
      const { guildId, userId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      const existing = await app.prisma.battlePet.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      if (existing) return serializePet(existing);
      const created = await app.prisma.battlePet.create({
        data: { guildId, userId },
      });
      return serializePet(created);
    },
  );

  app.patch(
    '/guilds/:guildId/battle-pets/:userId',
    {
      preHandler: app.requireBot(),
      schema: {
        params: PetParams,
        body: z.union([UpsertBattlePetNameSchema, AllocateStatsSchema]),
      },
    },
    async (req) => {
      const { guildId, userId } = req.params;
      const existing = await app.prisma.battlePet.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      if (!existing) throw HttpError.notFound('No battle pet for this user.');

      // Discriminate rename vs allocate by which fields are present.
      if ('name' in req.body && typeof req.body.name === 'string') {
        const updated = await app.prisma.battlePet.update({
          where: { guildId_userId: { guildId, userId } },
          data: { name: req.body.name },
        });
        return serializePet(updated);
      }

      const alloc = req.body as {
        atk: number;
        def: number;
        spd: number;
        maxHp: number;
      };
      const total = alloc.atk + alloc.def + alloc.spd + alloc.maxHp;
      if (total > existing.allocPoints) {
        throw HttpError.badRequest(
          `Not enough allocation points (have ${existing.allocPoints}, need ${total}).`,
        );
      }
      const newMaxHp = existing.maxHp + alloc.maxHp * 2; // each point = +2 maxHp
      const updated = await app.prisma.battlePet.update({
        where: { guildId_userId: { guildId, userId } },
        data: {
          atk: { increment: alloc.atk },
          def: { increment: alloc.def },
          spd: { increment: alloc.spd },
          maxHp: newMaxHp,
          // Heal up to the new max if we increased it.
          hp: existing.hp + alloc.maxHp * 2,
          allocPoints: { decrement: total },
        },
      });
      return serializePet(updated);
    },
  );

  app.get(
    '/guilds/:guildId/battle-leaderboard',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(10),
        }),
      },
    },
    async (req) => {
      const rows = await app.prisma.battlePet.findMany({
        where: { guildId: req.params.guildId },
        orderBy: [{ elo: 'desc' }, { wins: 'desc' }],
        take: req.query.limit,
      });
      return {
        entries: rows.map((p, i) => ({
          rank: i + 1,
          guildId: p.guildId,
          userId: p.userId,
          name: p.name,
          species: p.species,
          level: p.level,
          elo: p.elo,
          wins: p.wins,
          losses: p.losses,
          draws: p.draws,
        })),
      };
    },
  );

  // ─── Duels ──────────────────────────────────────────────────────────
  async function loadPets(
    guildId: string,
    challengerId: string,
    opponentId: string,
  ): Promise<{ challenger: PrismaBattlePet; opponent: PrismaBattlePet }> {
    // Auto-create pets if missing.
    const ensure = async (userId: string): Promise<PrismaBattlePet> => {
      const existing = await app.prisma.battlePet.findUnique({
        where: { guildId_userId: { guildId, userId } },
      });
      if (existing) return existing;
      return app.prisma.battlePet.create({ data: { guildId, userId } });
    };
    const [challenger, opponent] = await Promise.all([
      ensure(challengerId),
      ensure(opponentId),
    ]);
    return { challenger, opponent };
  }

  app.get(
    '/guilds/:guildId/duels',
    {
      preHandler: app.requireBot(),
      schema: {
        params: GuildParams,
        querystring: z.object({
          status: z.enum(['pending', 'active', 'ended', 'cancelled']).optional(),
          participant: SnowflakeSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
      },
    },
    async (req) => {
      const { guildId } = req.params;
      const { status, participant, limit } = req.query;
      const matches = await app.prisma.duelMatch.findMany({
        where: {
          guildId,
          ...(status ? { status } : {}),
          ...(participant
            ? { OR: [{ challengerId: participant }, { opponentId: participant }] }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      // Fetch pets in batch to compute live HP for each match. For listings we
      // skip per-match HP computation cost and use maxHp defaults — callers
      // hit GET /:id when they want the full board.
      return {
        matches: matches.map((m) => ({
          id: m.id,
          guildId: m.guildId,
          challengerId: m.challengerId,
          opponentId: m.opponentId,
          status: m.status as DuelStatus,
          turn: m.turn,
          currentActorId: m.currentActorId,
          winnerId: m.winnerId,
          createdAt: m.createdAt.toISOString(),
          endedAt: m.endedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.get(
    '/guilds/:guildId/duels/:id',
    { preHandler: app.requireBot(), schema: { params: DuelParams } },
    async (req) => {
      const m = await app.prisma.duelMatch.findFirst({
        where: { id: req.params.id, guildId: req.params.guildId },
      });
      if (!m) throw HttpError.notFound('Duel not found.');
      const { challenger, opponent } = await loadPets(
        m.guildId,
        m.challengerId,
        m.opponentId,
      );
      return serializeMatch(m, challenger.maxHp, opponent.maxHp);
    },
  );

  app.post(
    '/guilds/:guildId/duels',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: CreateDuelSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const guild = await app.prisma.guild.findUnique({ where: { id: guildId } });
      if (!guild) throw HttpError.notFound('Guild not registered.');
      if (req.body.challengerId === req.body.opponentId) {
        throw HttpError.badRequest('You cannot duel yourself.');
      }
      // Reject if either party is already in an active or pending duel.
      const existing = await app.prisma.duelMatch.findFirst({
        where: {
          guildId,
          status: { in: ['pending', 'active'] },
          OR: [
            { challengerId: req.body.challengerId },
            { challengerId: req.body.opponentId },
            { opponentId: req.body.challengerId },
            { opponentId: req.body.opponentId },
          ],
        },
      });
      if (existing) {
        throw HttpError.conflict('One of these duellists is already in a match.');
      }

      // Ensure both pets exist so subsequent reads don't have to.
      await loadPets(guildId, req.body.challengerId, req.body.opponentId);

      const created = await app.prisma.duelMatch.create({
        data: {
          guildId,
          challengerId: req.body.challengerId,
          opponentId: req.body.opponentId,
          status: 'pending',
          log: [],
        },
      });
      const { challenger, opponent } = await loadPets(
        guildId,
        req.body.challengerId,
        req.body.opponentId,
      );
      return serializeMatch(created, challenger.maxHp, opponent.maxHp);
    },
  );

  app.post(
    '/guilds/:guildId/duels/:id/respond',
    {
      preHandler: app.requireBot(),
      schema: { params: DuelParams, body: RespondDuelSchema },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const m = await app.prisma.duelMatch.findFirst({ where: { id, guildId } });
      if (!m) throw HttpError.notFound('Duel not found.');
      if (m.status !== 'pending') {
        throw HttpError.conflict('This duel is no longer pending.');
      }
      // Allow either side to cancel a pending duel; only the opponent may
      // accept it.
      if (req.body.action === 'accept' && req.body.userId !== m.opponentId) {
        throw HttpError.forbidden('Only the challenged opponent may accept.');
      }
      if (
        req.body.action === 'decline' &&
        req.body.userId !== m.opponentId &&
        req.body.userId !== m.challengerId
      ) {
        throw HttpError.forbidden('Only a participant may decline this duel.');
      }

      const { challenger, opponent } = await loadPets(
        guildId,
        m.challengerId,
        m.opponentId,
      );

      if (req.body.action === 'decline') {
        const updated = await app.prisma.duelMatch.update({
          where: { id },
          data: { status: 'cancelled', endedAt: new Date() },
        });
        return serializeMatch(updated, challenger.maxHp, opponent.maxHp);
      }

      // Accept — flip to active. Faster pet acts first.
      const firstActor =
        challenger.spd >= opponent.spd ? m.challengerId : m.opponentId;
      const updated = await app.prisma.duelMatch.update({
        where: { id },
        data: { status: 'active', turn: 1, currentActorId: firstActor },
      });
      return serializeMatch(updated, challenger.maxHp, opponent.maxHp);
    },
  );

  app.post(
    '/guilds/:guildId/duels/:id/forfeit',
    {
      preHandler: app.requireBot(),
      schema: {
        params: DuelParams,
        body: z.object({ userId: SnowflakeSchema }),
      },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const m = await app.prisma.duelMatch.findFirst({ where: { id, guildId } });
      if (!m) throw HttpError.notFound('Duel not found.');
      if (m.status !== 'active' && m.status !== 'pending') {
        throw HttpError.conflict('This duel is over.');
      }
      if (
        req.body.userId !== m.challengerId &&
        req.body.userId !== m.opponentId
      ) {
        throw HttpError.forbidden('Only a participant may forfeit.');
      }

      const { challenger, opponent } = await loadPets(
        guildId,
        m.challengerId,
        m.opponentId,
      );

      // Pending forfeit = cancel.
      if (m.status === 'pending') {
        const updated = await app.prisma.duelMatch.update({
          where: { id },
          data: { status: 'cancelled', endedAt: new Date() },
        });
        return {
          match: serializeMatch(updated, challenger.maxHp, opponent.maxHp),
          ended: true,
          winnerId: null,
          loserId: null,
          challengerEloDelta: 0,
          opponentEloDelta: 0,
          rewardCurrency: 0,
        };
      }

      // Active forfeit = opponent wins.
      const forfeiterIsChallenger = req.body.userId === m.challengerId;
      const winnerId = forfeiterIsChallenger ? m.opponentId : m.challengerId;
      const challengerScore = forfeiterIsChallenger ? 0 : 1;
      const challengerDelta = eloDelta(challenger.elo, opponent.elo, challengerScore);
      const opponentDelta = eloDelta(opponent.elo, challenger.elo, 1 - challengerScore);

      const challengerXpGain = forfeiterIsChallenger ? XP_LOSS : XP_WIN;
      const opponentXpGain = forfeiterIsChallenger ? XP_WIN : XP_LOSS;
      const challengerLevels = applyXp(challenger, challengerXpGain);
      const opponentLevels = applyXp(opponent, opponentXpGain);

      let reward = 0;
      const econ = await app.prisma.economyConfig.findUnique({ where: { guildId } });
      if (econ?.enabled) {
        reward = CURRENCY_REWARD;
        await app.prisma.balance.upsert({
          where: { guildId_userId: { guildId, userId: winnerId } },
          update: { amount: { increment: reward } },
          create: {
            guildId,
            userId: winnerId,
            amount: econ.startingBalance + reward,
          },
        });
      }

      const [updated] = await app.prisma.$transaction([
        app.prisma.duelMatch.update({
          where: { id },
          data: {
            status: 'ended',
            endedAt: new Date(),
            currentActorId: null,
            winnerId,
          },
        }),
        app.prisma.battlePet.update({
          where: { guildId_userId: { guildId, userId: m.challengerId } },
          data: {
            level: challengerLevels.level,
            xp: challengerLevels.xp,
            maxHp: challengerLevels.maxHp,
            hp: challengerLevels.maxHp,
            allocPoints: challengerLevels.allocPoints,
            elo: Math.max(0, challenger.elo + challengerDelta),
            wins: { increment: forfeiterIsChallenger ? 0 : 1 },
            losses: { increment: forfeiterIsChallenger ? 1 : 0 },
          },
        }),
        app.prisma.battlePet.update({
          where: { guildId_userId: { guildId, userId: m.opponentId } },
          data: {
            level: opponentLevels.level,
            xp: opponentLevels.xp,
            maxHp: opponentLevels.maxHp,
            hp: opponentLevels.maxHp,
            allocPoints: opponentLevels.allocPoints,
            elo: Math.max(0, opponent.elo + opponentDelta),
            wins: { increment: forfeiterIsChallenger ? 1 : 0 },
            losses: { increment: forfeiterIsChallenger ? 0 : 1 },
          },
        }),
      ]);

      return {
        match: serializeMatch(updated, challenger.maxHp, opponent.maxHp),
        ended: true,
        winnerId,
        loserId: req.body.userId,
        challengerEloDelta: challengerDelta,
        opponentEloDelta: opponentDelta,
        rewardCurrency: reward,
      };
    },
  );

  app.post(
    '/guilds/:guildId/duels/:id/move',
    {
      preHandler: app.requireBot(),
      schema: { params: DuelParams, body: SubmitDuelMoveSchema },
    },
    async (req) => {
      const { guildId, id } = req.params;
      const m = await app.prisma.duelMatch.findFirst({ where: { id, guildId } });
      if (!m) throw HttpError.notFound('Duel not found.');
      if (m.status === 'ended' || m.status === 'cancelled') {
        throw HttpError.conflict('This duel is over.');
      }
      if (m.status !== 'active') {
        throw HttpError.conflict('This duel has not started yet.');
      }
      if (m.currentActorId !== req.body.userId) {
        throw HttpError.forbidden("It is not your turn.");
      }
      const isChallengerTurn = req.body.userId === m.challengerId;
      const otherId = isChallengerTurn ? m.opponentId : m.challengerId;

      const { challenger, opponent } = await loadPets(guildId, m.challengerId, m.opponentId);
      const log = (Array.isArray(m.log) ? (m.log as unknown[]) : [])
        .map((e) => DuelLogEntrySchema.safeParse(e))
        .filter((r): r is Extract<typeof r, { success: true }> => r.success)
        .map((r) => r.data);
      const { challengerHp, opponentHp } = replayHp(
        challenger.maxHp,
        opponent.maxHp,
        log,
      );
      const { challengerDefending, opponentDefending } = defendingState(
        log,
        m.challengerId,
        m.opponentId,
      );

      const actor = isChallengerTurn ? challenger : opponent;
      const defender = isChallengerTurn ? opponent : challenger;
      const defenderDefending = isChallengerTurn ? opponentDefending : challengerDefending;

      const entry = resolveMove({
        move: req.body.move,
        actorIsChallenger: isChallengerTurn,
        actor,
        defender,
        challengerHp,
        opponentHp,
        defenderDefending,
        turn: m.turn,
      });

      const newLog = [...log, entry];
      const ended = entry.challengerHp <= 0 || entry.opponentHp <= 0;

      let winnerId: string | null = null;
      let loserId: string | null = null;
      let challengerDelta = 0;
      let opponentDelta = 0;
      let reward = 0;

      if (ended) {
        if (entry.challengerHp <= 0 && entry.opponentHp <= 0) {
          // Mutual KO — treat as draw.
          winnerId = null;
          loserId = null;
        } else if (entry.challengerHp <= 0) {
          winnerId = m.opponentId;
          loserId = m.challengerId;
        } else {
          winnerId = m.challengerId;
          loserId = m.opponentId;
        }

        const isDraw = winnerId === null;
        const challengerScore = isDraw ? 0.5 : winnerId === m.challengerId ? 1 : 0;
        const opponentScore = 1 - challengerScore;
        challengerDelta = eloDelta(challenger.elo, opponent.elo, challengerScore);
        opponentDelta = eloDelta(opponent.elo, challenger.elo, opponentScore);

        // Apply XP + bookkeeping to both pets.
        const challengerXpGain = isDraw
          ? XP_DRAW
          : winnerId === m.challengerId
            ? XP_WIN
            : XP_LOSS;
        const opponentXpGain = isDraw
          ? XP_DRAW
          : winnerId === m.opponentId
            ? XP_WIN
            : XP_LOSS;
        const challengerLevels = applyXp(challenger, challengerXpGain);
        const opponentLevels = applyXp(opponent, opponentXpGain);

        // Award currency reward when economy is enabled.
        const econ = await app.prisma.economyConfig.findUnique({
          where: { guildId },
        });
        if (econ?.enabled && winnerId) {
          reward = CURRENCY_REWARD;
          await app.prisma.balance.upsert({
            where: { guildId_userId: { guildId, userId: winnerId } },
            update: { amount: { increment: reward } },
            create: {
              guildId,
              userId: winnerId,
              amount: econ.startingBalance + reward,
            },
          });
        }

        const [updated] = await app.prisma.$transaction([
          app.prisma.duelMatch.update({
            where: { id },
            data: {
              status: 'ended',
              endedAt: new Date(),
              turn: m.turn + 1,
              currentActorId: null,
              log: newLog,
              winnerId,
            },
          }),
          app.prisma.battlePet.update({
            where: { guildId_userId: { guildId, userId: m.challengerId } },
            data: {
              level: challengerLevels.level,
              xp: challengerLevels.xp,
              maxHp: challengerLevels.maxHp,
              hp: challengerLevels.maxHp, // heal up on duel end
              allocPoints: challengerLevels.allocPoints,
              elo: Math.max(0, challenger.elo + challengerDelta),
              wins: { increment: isDraw ? 0 : winnerId === m.challengerId ? 1 : 0 },
              losses: { increment: isDraw ? 0 : winnerId === m.opponentId ? 1 : 0 },
              draws: { increment: isDraw ? 1 : 0 },
            },
          }),
          app.prisma.battlePet.update({
            where: { guildId_userId: { guildId, userId: m.opponentId } },
            data: {
              level: opponentLevels.level,
              xp: opponentLevels.xp,
              maxHp: opponentLevels.maxHp,
              hp: opponentLevels.maxHp,
              allocPoints: opponentLevels.allocPoints,
              elo: Math.max(0, opponent.elo + opponentDelta),
              wins: { increment: isDraw ? 0 : winnerId === m.opponentId ? 1 : 0 },
              losses: { increment: isDraw ? 0 : winnerId === m.challengerId ? 1 : 0 },
              draws: { increment: isDraw ? 1 : 0 },
            },
          }),
        ]);

        return {
          match: serializeMatch(updated, challenger.maxHp, opponent.maxHp),
          lastEntry: entry,
          ended: true,
          winnerId,
          loserId,
          challengerEloDelta: challengerDelta,
          opponentEloDelta: opponentDelta,
          rewardCurrency: reward,
        };
      }

      // Not ended — flip turn.
      const updated = await app.prisma.duelMatch.update({
        where: { id },
        data: {
          turn: m.turn + 1,
          currentActorId: otherId,
          log: newLog,
        },
      });
      return {
        match: serializeMatch(updated, challenger.maxHp, opponent.maxHp),
        lastEntry: entry,
        ended: false,
        winnerId: null,
        loserId: null,
        challengerEloDelta: 0,
        opponentEloDelta: 0,
        rewardCurrency: 0,
      };
    },
  );
};
