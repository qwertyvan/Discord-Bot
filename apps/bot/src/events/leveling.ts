import {
  ChannelType,
  Events,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
  type VoiceState,
} from 'discord.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

interface VoiceSession {
  joinedAt: number;
  channelId: string;
}
const voiceSessions = new Map<string, VoiceSession>(); // key: `${guildId}:${userId}`

function renderLevelUp(template: string, member: GuildMember, level: number): string {
  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.displayName)
    .replaceAll('{level}', String(level))
    .replaceAll('{server}', member.guild.name);
}

async function applyRoleRewards(
  member: GuildMember,
  previousLevel: number,
  newLevel: number,
  rewards: Array<{ level: number; roleId: string }>,
): Promise<void> {
  for (const reward of rewards) {
    if (reward.level > previousLevel && reward.level <= newLevel) {
      try {
        await member.roles.add(reward.roleId, `Reached level ${reward.level}`);
      } catch (err) {
        log.warn('Role reward assign failed', {
          guildId: member.guild.id,
          userId: member.id,
          roleId: reward.roleId,
          err: String(err),
        });
      }
    }
  }
}

async function announceLevelUp(
  guild: Guild,
  member: GuildMember,
  newLevel: number,
  fallbackChannelId: string,
): Promise<void> {
  const cfg = await api.getLevelConfig(guild.id).catch(() => null);
  if (!cfg) return;
  const template = cfg.levelUpTemplate ?? '🎉 {user} just reached level **{level}**!';
  const text = renderLevelUp(template, member, newLevel);

  const channelId = cfg.levelUpChannelId ?? fallbackChannelId;
  const channel = guild.channels.cache.get(channelId);
  if (channel && channel.type === ChannelType.GuildText) {
    await (channel as TextChannel)
      .send({ content: text, allowedMentions: { users: [member.id] } })
      .catch((err) => log.warn('Level-up announce failed', { guildId: guild.id, err: String(err) }));
  }

  if (cfg.roleRewards.length > 0) {
    // Assume we already crossed exactly newLevel; we don't know previousLevel here without a re-fetch.
    // Caller passes proper previousLevel in `awardXpFromMessage` instead.
  }
}

export function registerLevelingEvents(client: Client): void {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || !message.guildId || !message.guild) return;
    if (message.author.bot) return;

    let result;
    try {
      result = await api.awardTextXp(message.guildId, {
        userId: message.author.id,
        channelId: message.channelId,
      });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) {
        log.warn('awardTextXp failed', { guildId: message.guildId, err: String(err) });
      }
      return;
    }
    if (!result.applied || !result.leveledUp) return;

    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;

    const cfg = await api.getLevelConfig(message.guildId).catch(() => null);
    if (cfg?.roleRewards) {
      await applyRoleRewards(member, result.previousLevel, result.level, cfg.roleRewards);
    }
    await announceLevelUp(message.guild, member, result.level, message.channelId);
  });

  client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
    if (!newState.guild) return;
    const guildId = newState.guild.id;
    const userId = newState.id;
    const key = `${guildId}:${userId}`;

    // Started a voice session.
    if (!oldState.channelId && newState.channelId) {
      voiceSessions.set(key, { joinedAt: Date.now(), channelId: newState.channelId });
      return;
    }

    // Left a voice session.
    if (oldState.channelId && !newState.channelId) {
      const session = voiceSessions.get(key);
      voiceSessions.delete(key);
      if (!session) return;
      const minutes = Math.floor((Date.now() - session.joinedAt) / 60_000);
      if (minutes < 1) return;
      try {
        const result = await api.awardVoiceXp(guildId, { userId, minutes });
        if (result.leveledUp) {
          const member = newState.member ?? (await newState.guild.members.fetch(userId).catch(() => null));
          if (member) {
            const cfg = await api.getLevelConfig(guildId).catch(() => null);
            if (cfg?.roleRewards) {
              await applyRoleRewards(member, result.previousLevel, result.level, cfg.roleRewards);
            }
            await announceLevelUp(newState.guild, member, result.level, session.channelId);
          }
        }
      } catch (err) {
        log.warn('awardVoiceXp failed', { guildId, err: String(err) });
      }
    }
  });
}
