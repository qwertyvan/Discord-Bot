import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { registerReady } from './events/ready.js';
import { registerInteractionCreate } from './events/interactionCreate.js';
import { registerGuildLifecycle } from './events/guildLifecycle.js';
import { registerWelcomeEvents } from './events/welcome.js';

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // welcome/leave events
      GatewayIntentBits.GuildModeration, // moderation audit log entries
    ],
    partials: [Partials.GuildMember],
  });

  registerReady(client);
  registerInteractionCreate(client);
  registerGuildLifecycle(client);
  registerWelcomeEvents(client);

  return client;
}
