import { ChannelType, Events, type Client, type VoiceBasedChannel } from 'discord.js';
import { activityBatcher } from '../util/activity-batcher.js';

/**
 * Hook the per-guild activity batcher into Discord events: messages, joins,
 * leaves. Voice-minute counting is driven by the scheduler tick (see
 * `scheduler.ts`) — every 60s it inspects the cached voice state of each
 * guild and credits each connected (non-bot) member with one voice minute.
 */
export function registerInsightsEvents(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (!message.inGuild() || message.author.bot || !message.guildId) return;
    activityBatcher.recordMessage(message.guildId, message.channelId);
  });

  client.on(Events.GuildMemberAdd, (member) => {
    activityBatcher.recordJoin(member.guild.id);
  });

  client.on(Events.GuildMemberRemove, (member) => {
    activityBatcher.recordLeave(member.guild.id);
  });
}

/**
 * Count the (non-bot) members currently connected to a voice channel in each
 * guild. Called by the scheduler tick once a minute.
 */
export function tickVoiceMinutes(client: Client): void {
  for (const guild of client.guilds.cache.values()) {
    let count = 0;
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
        continue;
      }
      const voice = channel as VoiceBasedChannel;
      for (const member of voice.members.values()) {
        if (!member.user.bot) count += 1;
      }
    }
    if (count > 0) {
      activityBatcher.recordVoiceMinute(guild.id, count);
    }
  }
}
