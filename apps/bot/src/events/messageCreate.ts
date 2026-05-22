import { Events, type Client } from 'discord.js';
import { dispatchOnMessage } from '../plugins/index.js';

/**
 * Plugin-system fan-out for raw message create events. Other domain-specific
 * handlers (auto-response, leveling, automod, …) are registered separately
 * from this file and fire independently — this one exists solely to bridge
 * raw discord.js events into the plugin sandbox dispatcher.
 *
 * Bot-authored messages are skipped so plugins don't loop on their own output.
 */
export function registerMessageCreatePluginBridge(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) return;
    dispatchOnMessage(message);
  });
}
