import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { registerReady } from './events/ready.js';
import { registerInteractionCreate } from './events/interactionCreate.js';
import { registerGuildLifecycle } from './events/guildLifecycle.js';
import { registerWelcomeEvents } from './events/welcome.js';
import { registerAuditEvents } from './events/audit.js';
import { registerAutomodEvents } from './events/automod.js';
import { registerAutoResponseEvents } from './events/auto-response.js';
import { registerLevelingEvents } from './events/leveling.js';
import { registerMessageActivityEvents } from './events/message-activity.js';
import { registerTicketActivityEvents } from './events/ticket-activity.js';
import { startScheduler } from './scheduler.js';

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,        // welcome/leave + member updates
      GatewayIntentBits.GuildModeration,     // moderation audit-log entries
      GatewayIntentBits.GuildMessages,       // message edit/delete audit
      GatewayIntentBits.MessageContent,      // captures content for edit/delete logs
      GatewayIntentBits.GuildVoiceStates,    // voice join/leave audit
    ],
    partials: [Partials.GuildMember, Partials.Message, Partials.Channel],
  });

  registerReady(client);
  registerInteractionCreate(client);
  registerGuildLifecycle(client);
  registerWelcomeEvents(client);
  registerAuditEvents(client);
  registerAutomodEvents(client);
  registerAutoResponseEvents(client);
  registerLevelingEvents(client);
  registerMessageActivityEvents(client);
  registerTicketActivityEvents(client);
  startScheduler(client);

  return client;
}
