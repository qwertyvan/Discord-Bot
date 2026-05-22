import { activityRole } from './activity-roles.js';
import { prune } from './prune.js';
import { warnLadder } from './warn-ladder.js';
import { appeals } from './appeals.js';
import { apiToken } from './api-token.js';
import { webhooksOut } from './webhooks-out.js';

export const adminCommands = [activityRole, prune, warnLadder, appeals, webhooksOut, apiToken];
