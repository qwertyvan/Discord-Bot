import {
  ChannelType,
  EmbedBuilder,
  Events,
  type Client,
  type GuildMember,
  type PartialGuildMember,
  type TextChannel,
} from 'discord.js';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

/**
 * Boost-reward detection. Discord fires GuildMemberUpdate when premiumSince
 * transitions; we treat null → Date as "started boosting" and grant the
 * configured role + currency, then drop a celebratory embed.
 */
export function registerGuildMemberUpdate(client: Client): void {
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      await handleBoostTransition(oldMember, newMember);
    } catch (err) {
      log.warn('boost transition handler failed', {
        guildId: newMember.guild.id,
        userId: newMember.id,
        err: String(err),
      });
    }
  });
}

async function handleBoostTransition(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  // Only act on the null → Date transition. We ignore Date → null (un-boost)
  // and Date → Date refreshes here.
  const startedBoosting =
    !oldMember.premiumSince && newMember.premiumSince !== null && newMember.premiumSince !== undefined;
  if (!startedBoosting) return;

  const guildId = newMember.guild.id;
  let cfg;
  try {
    cfg = await api.getMilestoneConfig(guildId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return;
    log.warn('getMilestoneConfig failed', { guildId, err: String(err) });
    return;
  }
  if (!cfg.enabled) return;

  // Grant boost role.
  if (cfg.boostRoleId) {
    try {
      await newMember.roles.add(cfg.boostRoleId, 'Server boost reward');
    } catch (err) {
      log.warn('boost role add failed', {
        guildId,
        userId: newMember.id,
        roleId: cfg.boostRoleId,
        err: String(err),
      });
    }
  }

  // Pay currency.
  if (cfg.boostReward > 0) {
    try {
      await api.adjustBalance(guildId, newMember.id, cfg.boostReward);
    } catch (err) {
      log.warn('boost reward failed', { guildId, userId: newMember.id, err: String(err) });
    }
  }

  // Celebratory embed.
  if (cfg.boostChannelId) {
    const channel = newMember.guild.channels.cache.get(cfg.boostChannelId);
    if (channel && channel.type === ChannelType.GuildText) {
      const embed = new EmbedBuilder()
        .setTitle('🚀 Server boost!')
        .setDescription(
          `Thank you <@${newMember.id}> for boosting **${newMember.guild.name}**!`,
        )
        .setColor(0xf47fff)
        .setThumbnail(newMember.user.displayAvatarURL({ size: 256, extension: 'png' }))
        .setTimestamp(new Date());
      await (channel as TextChannel)
        .send({ embeds: [embed], allowedMentions: { users: [newMember.id] } })
        .catch((err) => log.warn('boost embed send failed', { guildId, err: String(err) }));
    }
  }

  // Record award (idempotency boundary is per premium-start; subsequent
  // null→Date transitions for the same user will record a new row).
  await api
    .recordMilestoneAward(guildId, {
      userId: newMember.id,
      kind: 'boost',
      payload: { startedAt: newMember.premiumSince?.toISOString() ?? new Date().toISOString() },
    })
    .catch((err) =>
      log.warn('boost recordAward failed', { guildId, userId: newMember.id, err: String(err) }),
    );
}
