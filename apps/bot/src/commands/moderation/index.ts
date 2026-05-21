import { kick } from './kick.js';
import { ban } from './ban.js';
import { unban } from './unban.js';
import { timeout } from './timeout.js';
import { purge } from './purge.js';
import { warn } from './warn.js';
import { warnings } from './warnings.js';

export const moderationCommands = [kick, ban, unban, timeout, purge, warn, warnings];
