import type { Guild, GuildMember, User } from 'discord.js';
import type { ModAction } from '@discord-bot/shared';
import { api, ApiError } from '../../api-client.js';
import { log } from '../../logger.js';

const MAX_TIMEOUT_MS = 28 * 86_400_000;
const DEFAULT_MUTE_MINUTES = 60;

/**
 * Evaluate the per-guild configurable warning ladder (WarningLadderStep) and
 * apply the highest-threshold action that's been crossed. Returns the
 * follow-up ModAction (or null when no step fired / action couldn't be
 * applied). Safe-by-design: any error is logged and swallowed.
 */
export async function applyLadderEscalation(
  guild: Guild,
  target: GuildMember,
  moderator: User,
): Promise<ModAction | null> {
  try {
    // Count active warnings for the user across all time. The API tracks the
    // soft-delete `active` flag — if no flag is present this still works
    // because listModActions returns all stored rows.
    const { actions } = await api.listModActions(guild.id, {
      userId: target.id,
      type: 'WARN',
      limit: 100,
    });
    const activeWarnings = actions.filter((a) => a.active !== false).length;
    if (activeWarnings === 0) return null;

    const { step } = await api.getTriggeredLadderStep(guild.id, activeWarnings);
    if (!step) return null;

    const reason = `Auto-escalation: reached ${activeWarnings} warning(s) (ladder threshold ${step.threshold}).`;
    const auditReason = `${moderator.tag}: ${reason}`;

    if (step.action === 'mute') {
      const minutes = step.durationMinutes ?? DEFAULT_MUTE_MINUTES;
      const duration = Math.min(minutes * 60_000, MAX_TIMEOUT_MS);
      if (!target.moderatable) return null;
      await target.timeout(duration, auditReason);
      const { action } = await api.createModAction(guild.id, {
        type: 'TIMEOUT',
        userId: target.id,
        moderatorId: moderator.id,
        reason,
        durationMs: duration,
        expiresAt: new Date(Date.now() + duration).toISOString(),
      });
      return action;
    }
    if (step.action === 'kick') {
      if (!target.kickable) return null;
      await target.kick(auditReason);
      const { action } = await api.createModAction(guild.id, {
        type: 'KICK',
        userId: target.id,
        moderatorId: moderator.id,
        reason,
      });
      return action;
    }
    if (step.action === 'ban') {
      if (!target.bannable) return null;
      await target.ban({ reason: auditReason });
      const { action } = await api.createModAction(guild.id, {
        type: 'BAN',
        userId: target.id,
        moderatorId: moderator.id,
        reason,
      });
      return action;
    }
    return null;
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn('Ladder escalation API failure', { guildId: guild.id, status: err.status });
    } else {
      log.warn('Ladder escalation failure', { guildId: guild.id, err: String(err) });
    }
    return null;
  }
}
