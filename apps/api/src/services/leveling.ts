import type { PrismaClient } from '@prisma/client';
import { levelFromXp } from '@discord-bot/shared';

export interface AwardResult {
  applied: boolean;
  xp: number;
  level: number;
  previousLevel: number;
  leveledUp: boolean;
}

/**
 * Award text XP. Honors the per-user cooldown configured on LevelConfig.
 * Returns leveledUp = true when the awarded XP pushed the user across a
 * level threshold so the bot can announce + apply role rewards.
 */
export async function awardTextXp(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  channelId: string,
): Promise<AwardResult> {
  const cfg = await prisma.levelConfig.findUnique({ where: { guildId } });
  if (!cfg?.enabled) {
    return { applied: false, xp: 0, level: 0, previousLevel: 0, leveledUp: false };
  }

  const existing = await prisma.memberLevel.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });

  if (existing?.lastTextXpAt) {
    const cooldownMs = cfg.textCooldownSeconds * 1000;
    const since = Date.now() - existing.lastTextXpAt.getTime();
    if (since < cooldownMs) {
      const lvl = levelFromXp(existing.xp);
      return { applied: false, xp: existing.xp, level: lvl, previousLevel: lvl, leveledUp: false };
    }
  }

  const multipliers = (cfg.channelMultipliers as Record<string, number>) ?? {};
  const multiplier = multipliers[channelId] ?? 1;
  const amount = Math.max(0, Math.round(cfg.perMessageXp * multiplier));
  if (amount === 0) {
    const lvl = levelFromXp(existing?.xp ?? 0);
    return { applied: false, xp: existing?.xp ?? 0, level: lvl, previousLevel: lvl, leveledUp: false };
  }

  const previousXp = existing?.xp ?? 0;
  const previousLevel = levelFromXp(previousXp);
  const newXp = previousXp + amount;
  const newLevel = levelFromXp(newXp);

  await prisma.memberLevel.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: { xp: newXp, lastTextXpAt: new Date() },
    create: { guildId, userId, xp: newXp, lastTextXpAt: new Date() },
  });

  return {
    applied: true,
    xp: newXp,
    level: newLevel,
    previousLevel,
    leveledUp: newLevel > previousLevel,
  };
}

export async function addVoiceXp(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  minutes: number,
): Promise<AwardResult> {
  const cfg = await prisma.levelConfig.findUnique({ where: { guildId } });
  if (!cfg?.enabled || cfg.voiceXpPerMinute === 0 || minutes <= 0) {
    const lvl = levelFromXp(0);
    return { applied: false, xp: 0, level: lvl, previousLevel: lvl, leveledUp: false };
  }

  const amount = cfg.voiceXpPerMinute * minutes;
  const existing = await prisma.memberLevel.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  const previousXp = existing?.xp ?? 0;
  const previousLevel = levelFromXp(previousXp);
  const newXp = previousXp + amount;
  const newLevel = levelFromXp(newXp);

  await prisma.memberLevel.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: { xp: newXp, voiceMinutes: { increment: minutes } },
    create: { guildId, userId, xp: newXp, voiceMinutes: minutes },
  });

  return {
    applied: true,
    xp: newXp,
    level: newLevel,
    previousLevel,
    leveledUp: newLevel > previousLevel,
  };
}
