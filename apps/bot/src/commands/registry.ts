import type { MessageContextCommand, SlashCommand } from '../command.js';
import { generalCommands } from './general/index.js';
import { moderationCommands } from './moderation/index.js';
import { onboardingCommands } from './onboarding/index.js';
import { levelingCommands } from './leveling/index.js';
import { economyCommands } from './economy/index.js';
import { ticketCommands } from './tickets/index.js';
import { scheduledCommands } from './scheduled/index.js';
import { communityCommands } from './community/index.js';
import { starboardCommands } from './starboard/index.js';
import { forumStageCommands } from './forum-stage/index.js';
import { utilityCommands } from './utility/index.js';
import { funCommands } from './fun/index.js';
import { voiceCommands } from './voice/index.js';
import { audioCommands } from './audio/index.js';
import { adminCommands } from './admin/index.js';
import { minigamesCommands } from './minigames/index.js';
import { backupCommands } from './backup/index.js';
import { musicCommands } from './music/index.js';
import { giveawayCommands } from './giveaways/index.js';
import { integrationsCommands } from './integrations/index.js';
import { safetyCommands, safetyContextCommands } from './safety/index.js';

export interface CommandEntry {
  group: string;
  command: SlashCommand;
}

export interface ContextCommandEntry {
  group: string;
  command: MessageContextCommand;
}

export interface CommandRegistry {
  byName: Map<string, SlashCommand>;
  entries: CommandEntry[];
  // Context-menu commands keyed by their visible name (e.g. "Report message").
  // Discord routes these through their own interaction type, so we keep a
  // separate map; they still serialize through the same REST PUT.
  contextByName: Map<string, MessageContextCommand>;
  contextEntries: ContextCommandEntry[];
}

let cached: CommandRegistry | null = null;

export function getCommandRegistry(): CommandRegistry {
  if (cached) return cached;

  const groups: Record<string, SlashCommand[]> = {
    general: generalCommands,
    moderation: moderationCommands,
    onboarding: onboardingCommands,
    leveling: levelingCommands,
    economy: economyCommands,
    tickets: ticketCommands,
    scheduled: scheduledCommands,
    community: communityCommands,
    starboard: starboardCommands,
    'forum-stage': forumStageCommands,
    utility: utilityCommands,
    fun: funCommands,
    voice: voiceCommands,
    audio: audioCommands,
    admin: adminCommands,
    minigames: minigamesCommands,
    backup: backupCommands,
    music: musicCommands,
    giveaways: giveawayCommands,
    integrations: integrationsCommands,
    safety: safetyCommands,
  };

  const contextGroups: Record<string, MessageContextCommand[]> = {
    safety: safetyContextCommands,
  };

  const byName = new Map<string, SlashCommand>();
  const entries: CommandEntry[] = [];
  for (const [group, cmds] of Object.entries(groups)) {
    for (const command of cmds) {
      const name = command.data.name;
      if (byName.has(name)) {
        throw new Error(`Duplicate command name: ${name}`);
      }
      byName.set(name, command);
      entries.push({ group, command });
    }
  }

  const contextByName = new Map<string, MessageContextCommand>();
  const contextEntries: ContextCommandEntry[] = [];
  for (const [group, cmds] of Object.entries(contextGroups)) {
    for (const command of cmds) {
      const name = command.data.name;
      if (contextByName.has(name)) {
        throw new Error(`Duplicate context command name: ${name}`);
      }
      contextByName.set(name, command);
      contextEntries.push({ group, command });
    }
  }

  cached = { byName, entries, contextByName, contextEntries };
  return cached;
}
