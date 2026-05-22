import { autoresponse } from './autoresponse.js';
import { avatar } from './avatar.js';
import { banner } from './banner.js';
import { channelinfo } from './channelinfo.js';
import { color } from './color.js';
import { counter } from './counter.js';
import { customCommand } from './custom-command.js';
import { help } from './help.js';
import { poll } from './poll.js';
import { preview } from './preview.js';
import { remindme } from './remindme.js';
import { reminders } from './reminders.js';
import { roles } from './roles.js';
import { roleinfo } from './roleinfo.js';
import { serverinfo } from './serverinfo.js';
import { shorten } from './shorten.js';
import { tag } from './tag.js';
import { time } from './time.js';
import { translate } from './translate.js';
import { userinfo } from './userinfo.js';

export const utilityCommands = [
  help,
  userinfo,
  serverinfo,
  roleinfo,
  channelinfo,
  avatar,
  banner,
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
  customCommand,
  counter,
  color,
];
