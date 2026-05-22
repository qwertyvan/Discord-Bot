import { Events, type Client } from 'discord.js';
import { dispatchOnMemberJoin } from '../plugins/index.js';

/**
 * Plugin-system fan-out for guild member joins. Welcome/audit/automod handle
 * their own logic on the same event — this listener only feeds the plugin
 * sandbox dispatcher.
 */
export function registerGuildMemberAddPluginBridge(client: Client): void {
  client.on(Events.GuildMemberAdd, (member) => {
    dispatchOnMemberJoin(member);
  });
}
