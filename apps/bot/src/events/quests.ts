import {
  ChannelType,
  Events,
  type Client,
  type VoiceBasedChannel,
} from 'discord.js';
import { questBus } from '../util/quest-bus.js';

/**
 * Wire the questBus into MessageCreate and MessageReactionAdd. Voice
 * minutes are credited from the scheduler tick (see `scheduler.ts`):
 * every minute we walk each guild's connected voice members and bump
 * `voice_minutes` progress for each non-bot user.
 */
export function registerQuestEvents(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    if (!message.inGuild() || message.author.bot || !message.guildId) return;
    questBus.recordMessage(message.guildId, message.author.id, message.channelId);
    if (message.attachments.size > 0) {
      // Treat any attachment that looks like an image as a send_image hit.
      // We don't fetch the file — Discord populates contentType eagerly.
      for (const att of message.attachments.values()) {
        if (att.contentType?.startsWith('image/')) {
          questBus.recordImageMessage(message.guildId, message.author.id);
          break;
        }
      }
    }
  });

  client.on(Events.MessageReactionAdd, (_reaction, user) => {
    const partialUser = user;
    if (partialUser.bot) return;
    const reaction = _reaction;
    // Partial reactions/messages don't expose guildId until fetched — bail
    // when we can't deduce a guild without an extra fetch round-trip.
    const msg = reaction.message;
    if (!msg.guildId) return;
    questBus.recordReaction(msg.guildId, partialUser.id, msg.channelId);
  });
}

/**
 * Called by the activity tick once per minute — credits one voice minute
 * of quest progress per (guild, member) currently connected to a voice
 * channel. Mirrors the insights `tickVoiceMinutes` but at member granularity.
 */
export function tickQuestVoiceMinutes(client: Client): void {
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (
        channel.type !== ChannelType.GuildVoice &&
        channel.type !== ChannelType.GuildStageVoice
      ) {
        continue;
      }
      const voice = channel as VoiceBasedChannel;
      for (const member of voice.members.values()) {
        if (member.user.bot) continue;
        questBus.recordVoiceMinute(guild.id, member.id);
      }
    }
  }
}
