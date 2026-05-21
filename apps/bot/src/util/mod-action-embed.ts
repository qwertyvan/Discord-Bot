import { EmbedBuilder, type User } from 'discord.js';
import type { ModAction, ModActionType } from '@discord-bot/shared';
import { formatDuration } from './duration.js';

const COLORS: Record<ModActionType, number> = {
  WARN: 0xfaa61a,
  KICK: 0xed4245,
  BAN: 0xed4245,
  UNBAN: 0x57f287,
  SOFTBAN: 0xed4245,
  TIMEOUT: 0xfaa61a,
  UNTIMEOUT: 0x57f287,
  MUTE: 0xfaa61a,
  UNMUTE: 0x57f287,
  NOTE: 0x5865f2,
};

const TITLES: Record<ModActionType, string> = {
  WARN: 'Warning issued',
  KICK: 'Member kicked',
  BAN: 'Member banned',
  UNBAN: 'Member unbanned',
  SOFTBAN: 'Member soft-banned',
  TIMEOUT: 'Member timed out',
  UNTIMEOUT: 'Timeout cleared',
  MUTE: 'Member muted',
  UNMUTE: 'Member unmuted',
  NOTE: 'Note added',
};

export function buildModActionEmbed(action: ModAction, target: User, moderator: User): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${TITLES[action.type]} · #${action.caseNumber}`)
    .setColor(COLORS[action.type])
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: 'User', value: `${target} (\`${target.id}\`)` },
      { name: 'Moderator', value: `${moderator}` },
      { name: 'Reason', value: action.reason },
    )
    .setTimestamp(new Date(action.createdAt));

  if (action.durationMs) {
    embed.addFields({ name: 'Duration', value: formatDuration(action.durationMs), inline: true });
  }
  return embed;
}
