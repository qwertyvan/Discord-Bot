import { antiRaid } from './anti-raid.js';
import { captchaTest } from './captcha-test.js';
import { verify } from './verify.js';
import { reports } from './reports.js';
import { reportMessageContext } from './report-context.js';
import { linkSafety } from './link-safety.js';

export const safetyCommands = [antiRaid, captchaTest, verify, reports, linkSafety];
export const safetyContextCommands = [reportMessageContext];
