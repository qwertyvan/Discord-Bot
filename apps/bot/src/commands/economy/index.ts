import { balance } from './balance.js';
import { daily } from './daily.js';
import { econLeaderboard } from './econ-leaderboard.js';
import { gamble } from './gamble.js';
import { inventory } from './inventory.js';
import { pay } from './pay.js';
import { shop } from './shop.js';
import { work } from './work.js';

export const economyCommands = [balance, daily, work, pay, shop, inventory, econLeaderboard, gamble];
