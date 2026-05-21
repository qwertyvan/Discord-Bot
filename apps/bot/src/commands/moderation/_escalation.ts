import type { Guild, GuildMember, User } from 'discord.js';
import { api, ApiError } from '../../api-client.js';
import { log } from '../../logger.js';
import type { ModAction } from '@discord-bot/shared';

const MAX_TIMEOUT_MS = 28 * 86_400_000;

/**
 * Execute a warning-policy escalation (kick/ban/timeout) on Discord and
 * record the follow-up ModAction. Returns the recorded action, or null if
 * the action could not be applied (e.g. bot lacks permission).
 */
export async function applyEscalation(
  guild: Guild,
  target: GuildMember,
  moderator: User,
  escalation: { action: 'TIMEOUT' | 'KICK' | 'BAN'; durationMs?: number; reason: string },
): Promise<ModAction | null> {
  const auditReason = `${moderator.tag}: ${escalation.reason}`;

  try {
    if (escalation.action === 'TIMEOUT') {
      const duration = Math.min(escalation.durationMs ?? 3_600_000, MAX_TIMEOUT_MS);
      if (!target.moderatable) return null;
      await target.timeout(duration, auditReason);
      const { action } = await api.createModAction(guild.id, {
        type: 'TIMEOUT',
        userId: target.id,
        moderatorId: moderator.id,
        reason: escalation.reason,
        durationMs: duration,
        expiresAt: new Date(Date.now() + duration).toISOString(),
      });
      return action;
    }
    if (escalation.action === 'KICK') {
      if (!target.kickable) return null;
      await target.kick(auditReason);
      const { action } = await api.createModAction(guild.id, {
        type: 'KICK',
        userId: target.id,
        moderatorId: moderator.id,
        reason: escalation.reason,
      });
      return action;
    }
    if (escalation.action === 'BAN') {
      if (!target.bannable) return null;
      await target.ban({ reason: auditReason });
      const { action } = await api.createModAction(guild.id, {
        type: 'BAN',
        userId: target.id,
        moderatorId: moderator.id,
        reason: escalation.reason,
      });
      return action;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn('Escalation API failure', { guildId: guild.id, status: err.status });
    } else {
      log.warn('Escalation Discord failure', { guildId: guild.id, err: String(err) });
    }
    return null;
  }
  return null;
}
