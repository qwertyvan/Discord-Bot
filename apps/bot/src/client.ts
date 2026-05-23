import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { registerReady } from './events/ready.js';
import { registerInteractionCreate } from './events/interactionCreate.js';
import { registerGuildLifecycle } from './events/guildLifecycle.js';
import { registerWelcomeEvents } from './events/welcome.js';
import { registerAuditEvents } from './events/audit.js';
import { registerAutomodEvents } from './events/automod.js';
import { registerLinkSafetyEvents } from './events/link-safety.js';
import { registerAutoResponseEvents } from './events/auto-response.js';
import { registerAutoReactionEvents } from './events/auto-reactions.js';
import { registerLevelingEvents } from './events/leveling.js';
import { registerMessageActivityEvents } from './events/message-activity.js';
import { registerTicketActivityEvents } from './events/ticket-activity.js';
import { registerStickyEvents } from './events/sticky.js';
import { registerVoiceStateEvents } from './events/voice-state.js';
import { registerInsightsEvents } from './events/insights.js';
import { registerMessageCreatePluginBridge } from './events/messageCreate.js';
import { registerGuildMemberAddPluginBridge } from './events/guildMemberAdd.js';
import { registerStarboardEvents } from './events/messageReaction.js';
import { registerQuestEvents } from './events/quests.js';
import { registerThreadCreate } from './events/threadCreate.js';
import { registerGuildMemberAdd } from './events/guildMemberAdd.js';
import { registerInviteTracking } from './events/inviteTracking.js';
import { registerGuildMemberUpdate } from './events/guildMemberUpdate.js';
import { registerAchievementEvents } from './events/achievements.js';
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
      GatewayIntentBits.GuildMembers,        // welcome/leave + member updates
      GatewayIntentBits.GuildModeration,     // moderation audit-log entries
      GatewayIntentBits.GuildMessages,       // message edit/delete audit
      GatewayIntentBits.MessageContent,      // captures content for edit/delete logs
      GatewayIntentBits.GuildVoiceStates,    // voice join/leave audit
      GatewayIntentBits.GuildMessageReactions, // starboard react-to-pin
      GatewayIntentBits.GuildInvites,          // invite-tracker InviteCreate/InviteDelete
    ],
    partials: [
      Partials.GuildMember,
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
    ],
  });

  registerReady(client);
  registerInteractionCreate(client);
  registerGuildLifecycle(client);
  registerWelcomeEvents(client);
  registerAuditEvents(client);
  registerAutomodEvents(client);
  registerLinkSafetyEvents(client);
  registerAutoResponseEvents(client);
  registerAutoReactionEvents(client);
  registerLevelingEvents(client);
  registerMessageActivityEvents(client);
  registerTicketActivityEvents(client);
  registerStickyEvents(client);
  registerVoiceStateEvents(client);
  registerInsightsEvents(client);
  registerMessageCreatePluginBridge(client);
  registerGuildMemberAddPluginBridge(client);
  registerStarboardEvents(client);
  registerQuestEvents(client);
  registerThreadCreate(client);
  registerGuildMemberAdd(client);
  registerInviteTracking(client);
  registerGuildMemberUpdate(client);
  registerAchievementEvents(client);
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
