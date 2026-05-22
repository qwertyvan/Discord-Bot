import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BetRequestSchema,
  DiceRequestSchema,
  SnowflakeSchema,
  type BlackjackState,
  type DiceResult,
  type SlotsResult,
} from '@discord-bot/shared';
import { HttpError } from '../errors.js';
import {
  diceResult as engineDice,
  drawCard,
  handValue,
  SeededRng,
  slotResult,
} from '../util/game-engines.js';

// Blackjack hands live in memory for the duration of the round. Persisting
// half-played hands to Postgres adds far more failure modes than it solves;
// if the API restarts mid-game the player loses their bet (a known trade-off
// — bets are server-side debited up front).
interface ActiveBlackjack extends BlackjackState {
  // Internal-only mutable copy of the dealer's complete hand; we expose only
  // the visible portion until the player stands.
  fullDealerHand: ReturnType<typeof drawCard>[];
  rng: SeededRng;
}

const games = new Map<string, ActiveBlackjack>();
const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Periodically prune stale games. A small interval is fine; the map is
// bounded by player count.
const pruneInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, g] of games) {
    if (new Date(g.expiresAt).getTime() <= now) games.delete(id);
  }
}, 60 * 1000);
// Don't keep the process alive just for the prune timer.
if (typeof pruneInterval.unref === 'function') pruneInterval.unref();

const GuildParams = z.object({ guildId: SnowflakeSchema });
const GameParams = z.object({
  guildId: SnowflakeSchema,
  gameId: z.string().uuid(),
});

function toPublicState(game: ActiveBlackjack): BlackjackState {
  return {
    gameId: game.gameId,
    guildId: game.guildId,
    userId: game.userId,
    bet: game.bet,
    playerHand: game.playerHand,
    dealerHand: game.dealerHand,
    dealerVisible: game.dealerVisible,
    playerTotal: game.playerTotal,
    dealerTotal: game.dealerTotal,
    status: game.status,
    payout: game.payout,
    expiresAt: game.expiresAt,
  };
}

async function debitBet(
  app: FastifyInstance,
  guildId: string,
  userId: string,
  bet: number,
): Promise<void> {
  const cfg = await app.prisma.economyConfig.findUnique({ where: { guildId } });
  if (!cfg?.enabled || !cfg.gamblingEnabled) {
    throw HttpError.conflict('Gambling is disabled in this guild.');
  }
  const balance = await app.prisma.balance.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!balance || balance.amount < bet) {
    throw HttpError.badRequest('Insufficient balance.');
  }
  await app.prisma.balance.update({
    where: { guildId_userId: { guildId, userId } },
    data: { amount: { decrement: bet } },
  });
}

async function creditPayout(
  app: FastifyInstance,
  guildId: string,
  userId: string,
  payout: number,
): Promise<number> {
  // payout is the gross amount returned to the player (bet * multiplier).
  if (payout <= 0) {
    const b = await app.prisma.balance.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    return b?.amount ?? 0;
  }
  const updated = await app.prisma.balance.update({
    where: { guildId_userId: { guildId, userId } },
    data: { amount: { increment: payout } },
  });
  return updated.amount;
}

export const gamesRoutes: FastifyPluginAsyncZod = async (app) => {
  // Blackjack: start a new round. Debits the bet, deals two cards each, and
  // returns the public state with the dealer's hole card hidden.
  app.post(
    '/guilds/:guildId/games/blackjack/start',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: BetRequestSchema },
    },
    async (req) => {
      const { guildId } = req.params;
      const { userId, bet } = req.body;
      await debitBet(app, guildId, userId, bet);

      const rng = new SeededRng();
      const playerHand = [drawCard(rng), drawCard(rng)];
      const fullDealerHand = [drawCard(rng), drawCard(rng)];
      const gameId = randomUUID();
      const playerEval = handValue(playerHand);
      const dealerEval = handValue(fullDealerHand);

      const game: ActiveBlackjack = {
        gameId,
        guildId,
        userId,
        bet,
        playerHand,
        // Only ever publish the visible dealer hand; the actual hole card stays
        // in fullDealerHand until the player stands.
        dealerHand: [],
        dealerVisible: [fullDealerHand[0]!],
        playerTotal: playerEval.total,
        dealerTotal: handValue([fullDealerHand[0]!]).total,
        status: 'active',
        payout: 0,
        expiresAt: new Date(Date.now() + FIVE_MINUTES_MS).toISOString(),
        fullDealerHand,
        rng,
      };

      // Natural blackjack: 21 from the opening deal. Pays 3:2 on the bet.
      if (playerEval.total === 21) {
        game.status = dealerEval.total === 21 ? 'push' : 'blackjack';
        game.dealerHand = fullDealerHand;
        game.dealerVisible = fullDealerHand;
        game.dealerTotal = dealerEval.total;
        if (game.status === 'blackjack') {
          // 3:2 payout returns bet + 1.5 * bet = 2.5x. Round down for ints.
          game.payout = Math.floor(bet * 2.5);
        } else {
          game.payout = bet; // push: refund
        }
        const balance = await creditPayout(app, guildId, userId, game.payout);
        return { state: toPublicState(game), balance };
      }

      games.set(gameId, game);
      return { state: toPublicState(game), balance: null };
    },
  );

  app.post(
    '/guilds/:guildId/games/blackjack/:gameId/hit',
    { preHandler: app.requireBot(), schema: { params: GameParams } },
    async (req) => {
      const { gameId, guildId } = req.params;
      const game = games.get(gameId);
      if (!game || game.guildId !== guildId) throw HttpError.notFound('Game not found.');
      if (game.status !== 'active') throw HttpError.conflict('Game already finished.');
      if (new Date(game.expiresAt).getTime() < Date.now()) {
        games.delete(gameId);
        throw HttpError.conflict('Game expired.');
      }

      game.playerHand.push(drawCard(game.rng));
      const { total } = handValue(game.playerHand);
      game.playerTotal = total;

      if (total > 21) {
        // Player busts. Reveal dealer hand for the embed.
        game.status = 'player-bust';
        game.dealerHand = game.fullDealerHand;
        game.dealerVisible = game.fullDealerHand;
        game.dealerTotal = handValue(game.fullDealerHand).total;
        const balance = await creditPayout(app, guildId, game.userId, 0);
        games.delete(gameId);
        return { state: toPublicState(game), balance };
      }

      return { state: toPublicState(game), balance: null };
    },
  );

  app.post(
    '/guilds/:guildId/games/blackjack/:gameId/stand',
    { preHandler: app.requireBot(), schema: { params: GameParams } },
    async (req) => {
      const { gameId, guildId } = req.params;
      const game = games.get(gameId);
      if (!game || game.guildId !== guildId) throw HttpError.notFound('Game not found.');
      if (game.status !== 'active') throw HttpError.conflict('Game already finished.');

      // Dealer draws to 17 (stands on all 17s).
      while (handValue(game.fullDealerHand).total < 17) {
        game.fullDealerHand.push(drawCard(game.rng));
      }
      game.dealerHand = game.fullDealerHand;
      game.dealerVisible = game.fullDealerHand;
      const dealerTotal = handValue(game.fullDealerHand).total;
      game.dealerTotal = dealerTotal;

      let payout = 0;
      if (dealerTotal > 21) {
        game.status = 'dealer-bust';
        payout = game.bet * 2; // return bet + win
      } else if (dealerTotal > game.playerTotal) {
        game.status = 'dealer-win';
        payout = 0;
      } else if (dealerTotal < game.playerTotal) {
        game.status = 'player-win';
        payout = game.bet * 2;
      } else {
        game.status = 'push';
        payout = game.bet; // refund
      }
      game.payout = payout;
      const balance = await creditPayout(app, guildId, game.userId, payout);
      games.delete(gameId);
      return { state: toPublicState(game), balance };
    },
  );

  // Slots: single-spin instant resolution.
  app.post(
    '/guilds/:guildId/games/slots',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: BetRequestSchema },
    },
    async (req): Promise<SlotsResult> => {
      const { guildId } = req.params;
      const { userId, bet } = req.body;
      await debitBet(app, guildId, userId, bet);
      const rng = new SeededRng();
      const outcome = slotResult(rng);
      // Total returned to player = bet * multiplier (so a 6x triple net-wins
      // 5*bet; a 0 multiplier loses the bet that was already debited).
      const payout = bet * outcome.multiplier;
      const balance = await creditPayout(app, guildId, userId, payout);
      const delta = payout - bet;
      return {
        reels: outcome.reels,
        multiplier: outcome.multiplier,
        delta,
        balance,
      };
    },
  );

  // Dice.
  app.post(
    '/guilds/:guildId/games/dice',
    {
      preHandler: app.requireBot(),
      schema: { params: GuildParams, body: DiceRequestSchema },
    },
    async (req): Promise<DiceResult> => {
      const { guildId } = req.params;
      const { userId, bet, choice } = req.body;
      await debitBet(app, guildId, userId, bet);
      const rng = new SeededRng();
      const outcome = engineDice(rng, choice);
      const payout = bet * outcome.multiplier;
      const balance = await creditPayout(app, guildId, userId, payout);
      const delta = payout - bet;
      return {
        roll: outcome.roll,
        choice,
        win: outcome.win,
        multiplier: outcome.multiplier,
        delta,
        balance,
      };
    },
  );
};
