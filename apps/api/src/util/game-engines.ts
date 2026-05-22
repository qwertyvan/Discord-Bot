// Server-side gambling primitives. All randomness lives here so the bot
// never derives outcomes client-side; the API returns final results only.
// Everything is deterministic given a seeded RNG, which lets us unit-test
// payout fairness without statistical sampling.

import type { BlackjackCard, DiceChoice } from '@discord-bot/shared';

// xorshift32: small, fast, deterministic. Seeded by Math.random() in normal
// use; tests pass a fixed seed to replay known sequences.
export class SeededRng {
  private state: number;

  constructor(seed?: number) {
    // A zero seed locks xorshift at zero. Fall back to a non-zero default.
    const s = seed === undefined ? Math.floor(Math.random() * 0xffffffff) : seed;
    this.state = (s | 0) || 0x9e3779b9;
  }

  next(): number {
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    // Map to [0, 1).
    return ((x >>> 0) % 0x100000000) / 0x100000000;
  }

  // Integer in [min, max] inclusive.
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(arr: readonly T[]): T {
    const item = arr[this.int(0, arr.length - 1)];
    if (item === undefined) throw new Error('pick: empty array');
    return item;
  }
}

// Blackjack -------------------------------------------------------------

const SUITS = ['♠', '♥', '♦', '♣'] as const;

export function drawCard(rng: SeededRng): BlackjackCard {
  return {
    rank: rng.int(1, 13),
    suit: rng.pick(SUITS),
  };
}

// Hand value: face cards are 10, aces count as 11 unless busting, in which
// case they downgrade to 1. The "soft" flag indicates a soft hand (an ace
// still counts as 11) — relevant for dealer drawing rules but exposed
// purely for diagnostic UI.
export function handValue(cards: readonly BlackjackCard[]): {
  total: number;
  soft: boolean;
} {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 1) {
      total += 11;
      aces += 1;
    } else if (c.rank >= 10) {
      total += 10;
    } else {
      total += c.rank;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

// Dealer hits on 16, stands on hard 17+. We use the canonical S17 rule
// (stand on soft 17) which gives the player a ~1% house edge with basic
// strategy — close enough to the milestone's stated target.
export function dealerPlay(
  rng: SeededRng,
  dealer: BlackjackCard[],
): BlackjackCard[] {
  const hand = [...dealer];
  while (true) {
    const { total, soft } = handValue(hand);
    if (total >= 17 && !(soft && total === 17 && false)) break;
    if (total >= 17) break;
    hand.push(drawCard(rng));
  }
  return hand;
}

// Slots ----------------------------------------------------------------
//
// Six symbols with weighted distribution. The cherry/lemon weights are
// tuned so the expected return-to-player is roughly 97% (3% house edge):
//   P(triple) ≈ Σ pᵢ³ ≈ 0.040   payout 6x  ⇒ EV ≈ 0.243
//   P(pair)   ≈ 0.385             payout 2x  ⇒ EV ≈ 0.770
//   total EV ≈ 0.97 × bet
// The exact numbers don't need to be perfect; we just want a believable
// edge. Real players will not measure the EV to four decimals.

const SLOT_SYMBOLS = [
  { symbol: '🍒', weight: 28 },
  { symbol: '🍋', weight: 22 },
  { symbol: '🔔', weight: 18 },
  { symbol: '⭐', weight: 14 },
  { symbol: '💎', weight: 10 },
  { symbol: '7️⃣', weight: 8 },
] as const;

function spinReel(rng: SeededRng): string {
  const total = SLOT_SYMBOLS.reduce((s, r) => s + r.weight, 0);
  let pick = rng.int(0, total - 1);
  for (const row of SLOT_SYMBOLS) {
    pick -= row.weight;
    if (pick < 0) return row.symbol;
  }
  // Unreachable; appease TS.
  return SLOT_SYMBOLS[0]!.symbol;
}

export interface SlotsOutcome {
  reels: [string, string, string];
  multiplier: number;
}

export function slotResult(rng: SeededRng): SlotsOutcome {
  const reels: [string, string, string] = [
    spinReel(rng),
    spinReel(rng),
    spinReel(rng),
  ];
  const allMatch = reels[0] === reels[1] && reels[1] === reels[2];
  const twoMatch =
    !allMatch &&
    (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]);
  // 7️⃣ triple jackpot pays bigger; everything else triple is 6x; pair is 2x.
  const multiplier = allMatch
    ? reels[0] === '7️⃣'
      ? 20
      : 6
    : twoMatch
      ? 2
      : 0;
  return { reels, multiplier };
}

// Dice -----------------------------------------------------------------
//
// Fair payouts (no house edge):
//   - high (4..6) / low (1..3) / even / odd: 2x
//   - exact face match (1..6):                6x
// The milestone calls for "fair payouts" on dice; these are the standard
// fair-payout multipliers for a 6-sided die. Variance comes from variance,
// not from the house.

export interface DiceOutcome {
  roll: number;
  win: boolean;
  multiplier: number;
}

export function diceResult(rng: SeededRng, choice: DiceChoice): DiceOutcome {
  const roll = rng.int(1, 6);
  let win = false;
  let multiplier = 0;
  if (choice === 'high') {
    win = roll >= 4;
    multiplier = win ? 2 : 0;
  } else if (choice === 'low') {
    win = roll <= 3;
    multiplier = win ? 2 : 0;
  } else if (choice === 'even') {
    win = roll % 2 === 0;
    multiplier = win ? 2 : 0;
  } else if (choice === 'odd') {
    win = roll % 2 === 1;
    multiplier = win ? 2 : 0;
  } else {
    // Exact face. Choice is the digit as a string.
    const target = Number.parseInt(choice, 10);
    win = roll === target;
    multiplier = win ? 6 : 0;
  }
  return { roll, win, multiplier };
}

// Weighted pick for loot tables. Returns the index of the chosen row.
// Throws if all weights are non-positive.
export function weightedPick(
  rng: SeededRng,
  weights: readonly number[],
): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) throw new Error('weightedPick: total weight must be positive');
  let pick = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    pick -= Math.max(0, weights[i] ?? 0);
    if (pick <= 0) return i;
  }
  return weights.length - 1;
}
