import { autoresponse } from './autoresponse.js';
import { avatar } from './avatar.js';
import { poll } from './poll.js';
import { preview } from './preview.js';
import { remindme } from './remindme.js';
import { reminders } from './reminders.js';
import { roles } from './roles.js';
import { serverinfo } from './serverinfo.js';
import { shorten } from './shorten.js';
import { tag } from './tag.js';
import { time } from './time.js';
import { translate } from './translate.js';
import { userinfo } from './userinfo.js';

export const utilityCommands = [
  userinfo,
  serverinfo,
  avatar,
  roles,
  poll,
  remindme,
  reminders,
  tag,
  autoresponse,
  time,
  preview,
  translate,
  shorten,
];
