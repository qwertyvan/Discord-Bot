import { autoresponse } from './autoresponse.js';
import { avatar } from './avatar.js';
import { poll } from './poll.js';
import { remindme } from './remindme.js';
import { reminders } from './reminders.js';
import { roles } from './roles.js';
import { serverinfo } from './serverinfo.js';
import { tag } from './tag.js';
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
];
