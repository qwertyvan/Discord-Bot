import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
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
import { registerStickyEvents } from './events/sticky.js';
import { registerVoiceStateEvents } from './events/voice-state.js';
import { registerInsightsEvents } from './events/insights.js';
import { registerMessageCreatePluginBridge } from './events/messageCreate.js';
import { registerGuildMemberAddPluginBridge } from './events/guildMemberAdd.js';
import { startScheduler } from './scheduler.js';
import { scanPluginsDir } from './plugins/index.js';
import { log } from './logger.js';

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // welcome/leave + member updates
      GatewayIntentBits.GuildModeration, // moderation audit-log entries
      GatewayIntentBits.GuildMessages, // message edit/delete audit
      GatewayIntentBits.MessageContent, // captures content for edit/delete logs
      GatewayIntentBits.GuildVoiceStates, // voice join/leave audit
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
  registerStickyEvents(client);
  registerVoiceStateEvents(client);
  registerInsightsEvents(client);
  registerMessageCreatePluginBridge(client);
  registerGuildMemberAddPluginBridge(client);
  startScheduler(client);

  // Load plugins after the gateway is ready. Doing this in `once(ready)`
  // (instead of at client construction) ensures any plugin that races against
  // bot init can still observe a live, logged-in client through future hooks.
  client.once(Events.ClientReady, () => {
    scanPluginsDir().catch((err) => {
      log.warn('Plugin scan failed on ready', { err: String(err) });
    });
  });

  return client;
}
