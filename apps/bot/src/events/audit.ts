import {
  ChannelType,
  Events,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type PartialMessage,
  type TextChannel,
  type VoiceState,
  type GuildChannel,
} from 'discord.js';
import type { AuditEventType, CreateAuditEventInput } from '@discord-bot/shared';
import { api } from '../api-client.js';
import { log } from '../logger.js';
import { getLoggingConfig } from '../util/logging-cache.js';

/**
 * Dispatch an audit event: persist via API (best-effort) and post a formatted
 * message to the configured log channel if logging is enabled for the event
 * type. Events default to enabled when the cfg.events map has no entry.
 */
async function dispatch(
  guild: Guild,
  type: AuditEventType,
  description: string,
  extra: Omit<CreateAuditEventInput, 'type'> = {},
): Promise<void> {
  const cfg = await getLoggingConfig(guild.id);
  if (!cfg?.enabled) return;
  if (cfg.events[type] === false) return;

  api.createAuditEvent(guild.id, { type, ...extra }).catch((err) => {
    log.warn('Failed to record audit event', { guildId: guild.id, type, err: String(err) });
  });

  if (!cfg.channelId) return;
  const channel = await resolveChannel(guild, cfg.channelId);
  if (!channel) return;
  await channel.send({ content: description, allowedMentions: { parse: [] } }).catch((err) => {
    log.warn('Failed to post audit log message', { guildId: guild.id, type, err: String(err) });
  });
}

async function resolveChannel(guild: Guild, channelId: string): Promise<TextChannel | null> {
  const cached = guild.channels.cache.get(channelId);
  const channel = cached ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) return null;
  return channel.type === ChannelType.GuildText ? (channel as TextChannel) : null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function registerAuditEvents(client: Client): void {
  client.on(Events.MessageDelete, async (message) => {
    const partial = message as Message | PartialMessage;
    if (!partial.inGuild() || !partial.guild) return;
    if (partial.author?.bot) return;
    const content = partial.content
      ? truncate(partial.content, 500)
      : '*(content not cached)*';
    await dispatch(
      partial.guild,
      'MESSAGE_DELETE',
      `🗑️ **Message deleted** in <#${partial.channelId}> by <@${partial.author?.id ?? 'unknown'}>:\n${content}`,
      {
        ...(partial.author?.id ? { userId: partial.author.id } : {}),
        channelId: partial.channelId,
        payload: { messageId: partial.id, content: partial.content ?? null },
      },
    );
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    const oldM = oldMessage as Message | PartialMessage;
    const newM = newMessage as Message | PartialMessage;
    if (!newM.inGuild() || !newM.guild) return;
    if (newM.author?.bot) return;
    if (oldM.content === newM.content) return;
    const before = oldM.content ? truncate(oldM.content, 300) : '*(not cached)*';
    const after = newM.content ? truncate(newM.content, 300) : '*(empty)*';
    await dispatch(
      newM.guild,
      'MESSAGE_EDIT',
      `✏️ **Message edited** in <#${newM.channelId}> by <@${newM.author?.id ?? 'unknown'}>\n**Before:** ${before}\n**After:** ${after}`,
      {
        ...(newM.author?.id ? { userId: newM.author.id } : {}),
        channelId: newM.channelId,
        payload: { messageId: newM.id, before: oldM.content ?? null, after: newM.content ?? null },
      },
    );
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    await dispatch(
      member.guild,
      'MEMBER_JOIN',
      `📥 **${member.user.tag}** (\`${member.id}\`) joined.`,
      { userId: member.id, payload: { tag: member.user.tag } },
    );
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    await dispatch(
      member.guild,
      'MEMBER_LEAVE',
      `📤 **${member.user.tag}** (\`${member.id}\`) left.`,
      { userId: member.id, payload: { tag: member.user.tag } },
    );
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));

    for (const r of added.values()) {
      await dispatch(
        newMember.guild,
        'MEMBER_ROLE_ADD',
        `➕ **${newMember.user.tag}** received role **${r.name}**.`,
        { userId: newMember.id, payload: { roleId: r.id, roleName: r.name } },
      );
    }
    for (const r of removed.values()) {
      await dispatch(
        newMember.guild,
        'MEMBER_ROLE_REMOVE',
        `➖ **${newMember.user.tag}** lost role **${r.name}**.`,
        { userId: newMember.id, payload: { roleId: r.id, roleName: r.name } },
      );
    }

    if (oldMember.nickname !== newMember.nickname) {
      await dispatch(
        newMember.guild,
        'MEMBER_NICKNAME_CHANGE',
        `✏️ Nickname change for **${newMember.user.tag}**: \`${oldMember.nickname ?? '∅'}\` → \`${newMember.nickname ?? '∅'}\``,
        { userId: newMember.id, payload: { before: oldMember.nickname, after: newMember.nickname } },
      );
    }
    void (newMember as GuildMember); // appease unused-var when GuildMember import is otherwise unused
  });

  client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;
    await dispatch(
      channel.guild,
      'CHANNEL_CREATE',
      `📺 Channel created: **#${channel.name}** (\`${channel.id}\`).`,
      { channelId: channel.id, payload: { name: channel.name, type: channel.type } },
    );
    void (channel as GuildChannel);
  });

  client.on(Events.ChannelDelete, async (channel) => {
    if (!('guild' in channel) || !channel.guild) return;
    await dispatch(
      channel.guild,
      'CHANNEL_DELETE',
      `🗑️ Channel deleted: **#${channel.name}** (\`${channel.id}\`).`,
      { channelId: channel.id, payload: { name: channel.name, type: channel.type } },
    );
  });

  client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
    if (!newState.guild) return;
    if (!oldState.channelId && newState.channelId) {
      await dispatch(
        newState.guild,
        'VOICE_JOIN',
        `🔊 <@${newState.id}> joined voice <#${newState.channelId}>.`,
        { userId: newState.id, channelId: newState.channelId },
      );
    } else if (oldState.channelId && !newState.channelId) {
      await dispatch(
        newState.guild,
        'VOICE_LEAVE',
        `🔇 <@${newState.id}> left voice <#${oldState.channelId}>.`,
        { userId: newState.id, channelId: oldState.channelId },
      );
    }
  });
}
