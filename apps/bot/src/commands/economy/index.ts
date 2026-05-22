import { balance } from './balance.js';
import { blackjack } from './blackjack.js';
import { buy } from './buy.js';
import { daily } from './daily.js';
import { dice } from './dice.js';
import { econLeaderboard } from './econ-leaderboard.js';
import { gamble } from './gamble.js';
import { gift } from './gift.js';
import { inventory } from './inventory.js';
import { loot } from './loot.js';
import { pay } from './pay.js';
import { shop } from './shop.js';
import { slots } from './slots.js';
import { use } from './use.js';
import { work } from './work.js';

export const economyCommands = [
  balance,
  daily,
  work,
  pay,
  shop,
  buy,
  inventory,
  gift,
  use,
  econLeaderboard,
  gamble,
  blackjack,
  slots,
  dice,
  loot,
];
