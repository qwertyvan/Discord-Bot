import { play } from './play.js';
import { queue } from './queue.js';
import { skip } from './skip.js';
import { pause, resume } from './pause.js';
import { loop } from './loop.js';
import { shuffle } from './shuffle.js';
import { volume } from './volume.js';
import { lyrics } from './lyrics.js';
import { stop } from './stop.js';

export const musicCommands = [play, queue, skip, pause, resume, loop, shuffle, volume, lyrics, stop];
