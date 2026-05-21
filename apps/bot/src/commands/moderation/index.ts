import { ban } from './ban.js';
import { caseCommand } from './case.js';
import { history } from './history.js';
import { kick } from './kick.js';
import { lockdown } from './lockdown.js';
import { massban } from './massban.js';
import { masskick } from './masskick.js';
import { mute } from './mute.js';
import { note } from './note.js';
import { purge } from './purge.js';
import { slow } from './slow.js';
import { softban } from './softban.js';
import { timeout } from './timeout.js';
import { unban } from './unban.js';
import { unlockdown } from './unlockdown.js';
import { unmute } from './unmute.js';
import { warn } from './warn.js';
import { warnings } from './warnings.js';

export const moderationCommands = [
  warn,
  warnings,
  kick,
  ban,
  unban,
  softban,
  timeout,
  mute,
  unmute,
  massban,
  masskick,
  note,
  history,
  caseCommand,
  lockdown,
  unlockdown,
  slow,
  purge,
];
