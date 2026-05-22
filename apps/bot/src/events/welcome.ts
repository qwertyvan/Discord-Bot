import {
  AttachmentBuilder,
  ChannelType,
  Events,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { log } from '../logger.js';
import { api, ApiError } from '../api-client.js';
import { renderTemplate } from '../welcome/template.js';
import { renderWelcomeCard } from '../util/canvas/welcome-card.js';
import { ttsUrl } from '../util/tts.js';
import { connectAndPlay } from '../util/voice-player.js';

export function registerWelcomeEvents(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    const config = await fetchConfig(member.guild.id);
    if (!config?.enabled) return;

    if (config.channelId && config.joinTemplate) {
      const channel = await resolveTextChannel(member.guild, config.channelId);
      if (channel) {
        const message = renderTemplate(config.joinTemplate, {
          user: member.user,
          member,
          guild: member.guild,
        });
        const files = [];
        if (config.cardEnabled) {
          try {
            const png = await renderWelcomeCard({
              username: member.displayName,
              avatarUrl: member.user.displayAvatarURL({ size: 256, extension: 'png' }),
              serverName: member.guild.name,
              memberCount: member.guild.memberCount,
              backgroundUrl: config.cardBackgroundUrl,
            });
            files.push(new AttachmentBuilder(png, { name: 'welcome.png' }));
          } catch (err) {
            log.warn('Welcome card render failed', {
              guildId: member.guild.id,
              err: String(err),
            });
          }
        }
        // allowedMentions limits pings to the joining user — load-bearing for
        // the {username} placeholder, which renders literal text from the
        // user's display name and could otherwise become an @everyone if
        // allowedMentions were relaxed.
        await channel
          .send({ content: message, files, allowedMentions: { users: [member.id] } })
          .catch((err) => {
            log.warn('Failed to send welcome message', { guildId: member.guild.id, err: String(err) });
          });
      }
    }

    if (config.dmTemplate) {
      const dm = renderTemplate(config.dmTemplate, {
        user: member.user,
        member,
        guild: member.guild,
      });
      await member.send({ content: dm }).catch(() => {
        // Users with closed DMs are common — silent skip.
      });
    }

    if (config.autoRoleIds.length > 0) {
      await applyAutoRoles(member, config.autoRoleIds);
    }

    // TTS welcome announcement — best-effort; failures must not block the
    // rest of the join flow. Runs after the welcome card so the channel
    // message arrives first.
    try {
      const tts = await api.getTtsConfig(member.guild.id).catch(() => null);
      if (tts?.enabled && tts.welcomeText && tts.voiceChannelId) {
        const rendered = renderTemplate(tts.welcomeText, {
          user: member.user,
          member,
          guild: member.guild,
        });
        await connectAndPlay(member.guild, tts.voiceChannelId, ttsUrl(rendered, tts.language));
      }
    } catch (err) {
      log.warn('TTS welcome announcement failed', {
        guildId: member.guild.id,
        err: String(err),
      });
    }

    if (config.milestoneEvery && config.milestoneTemplate && config.channelId) {
      // memberCount has already been incremented at this point.
      if (member.guild.memberCount % config.milestoneEvery === 0) {
        const channel = await resolveTextChannel(member.guild, config.channelId);
        if (channel) {
          const msg = renderTemplate(config.milestoneTemplate, {
            user: member.user,
            member,
            guild: member.guild,
          });
          await channel.send({ content: msg, allowedMentions: { parse: [] } }).catch((err) => {
            log.warn('Failed to send milestone message', {
              guildId: member.guild.id,
              err: String(err),
            });
          });
        }
      }
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const config = await fetchConfig(member.guild.id);
    if (!config?.enabled || !config.channelId || !config.leaveTemplate) return;
    const channel = await resolveTextChannel(member.guild, config.channelId);
    if (!channel) return;
    const message = renderTemplate(config.leaveTemplate, {
      user: member.user,
      member,
      guild: member.guild,
    });
    await channel.send({ content: message, allowedMentions: { parse: [] } }).catch((err) => {
      log.warn('Failed to send leave message', { guildId: member.guild.id, err: String(err) });
    });

    // TTS goodbye — same best-effort pattern as the join hook.
    try {
      const tts = await api.getTtsConfig(member.guild.id).catch(() => null);
      if (tts?.enabled && tts.goodbyeText && tts.voiceChannelId) {
        const rendered = renderTemplate(tts.goodbyeText, {
          user: member.user,
          // member is a PartialGuildMember here — template only reads
          // `displayName`/etc., so the partial is sufficient.
          member,
          guild: member.guild,
        });
        await connectAndPlay(member.guild, tts.voiceChannelId, ttsUrl(rendered, tts.language));
      }
    } catch (err) {
      log.warn('TTS goodbye announcement failed', {
        guildId: member.guild.id,
        err: String(err),
      });
    }
  });
}

async function applyAutoRoles(member: GuildMember, roleIds: string[]): Promise<void> {
  for (const roleId of roleIds) {
    try {
      await member.roles.add(roleId, 'Auto-role on join');
    } catch (err) {
      log.warn('Auto-role assignment failed', {
        guildId: member.guild.id,
        userId: member.id,
        roleId,
        err: String(err),
      });
    }
  }
}

async function resolveTextChannel(guild: Guild, channelId: string): Promise<TextChannel | null> {
  const cached = guild.channels.cache.get(channelId);
  if (cached) {
    return cached.type === ChannelType.GuildText ? (cached as TextChannel) : null;
  }
  const fetched = await guild.channels.fetch(channelId).catch(() => null);
  if (!fetched) {
    log.info('Welcome channel missing — was it deleted?', { guildId: guild.id, channelId });
    return null;
  }
  return fetched.type === ChannelType.GuildText ? (fetched as TextChannel) : null;
}

async function fetchConfig(guildId: string) {
  try {
    return await api.getWelcomeConfig(guildId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    log.warn('Failed to fetch welcome config', { guildId, err: String(err) });
    return null;
  }
}
