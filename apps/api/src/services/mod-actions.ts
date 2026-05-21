import type { PrismaClient, ModAction } from '@prisma/client';
import type { CreateModActionInput } from '@discord-bot/shared';
import { HttpError } from '../errors.js';

/**
 * Create a moderation action with an atomically-allocated per-guild case
 * number, then evaluate any configured warning thresholds.
 *
 * Returns the created action and (if a threshold fired) the follow-up action
 * the bot should execute on Discord (timeout / kick / ban).
 */
export interface CreatedAction {
  action: ModAction;
  triggeredEscalation: {
    action: 'TIMEOUT' | 'KICK' | 'BAN';
    durationMs?: number;
    reason: string;
  } | null;
}

export async function createModAction(
  prisma: PrismaClient,
  guildId: string,
  input: CreateModActionInput,
): Promise<CreatedAction> {
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) throw HttpError.notFound('Guild not registered.');

  const created = await prisma.$transaction(async (tx) => {
    const counter = await tx.caseCounter.upsert({
      where: { guildId },
      update: { next: { increment: 1 } },
      create: { guildId, next: 2 },
    });
    const caseNumber = counter.next - 1;

    return tx.modAction.create({
      data: {
        guildId,
        caseNumber,
        type: input.type,
        userId: input.userId,
        moderatorId: input.moderatorId,
        reason: input.reason,
        durationMs: input.durationMs ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        category: input.category ?? null,
        severity: input.severity ?? null,
      },
    });
  });

  let triggeredEscalation: CreatedAction['triggeredEscalation'] = null;

  // Only warnings trigger escalation evaluation.
  if (input.type === 'WARN') {
    triggeredEscalation = await evaluateWarningThresholds(prisma, guildId, input.userId);
  }

  return { action: created, triggeredEscalation };
}

async function evaluateWarningThresholds(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<CreatedAction['triggeredEscalation']> {
  const policy = await prisma.warningPolicy.findUnique({ where: { guildId } });
  if (!policy) return null;
  const thresholds = parseThresholds(policy.thresholds);
  if (thresholds.length === 0) return null;

  const activeWarnings = await prisma.modAction.count({
    where: { guildId, userId, type: 'WARN', active: true },
  });

  // Pick the highest threshold that's been crossed.
  const triggered = thresholds
    .filter((t) => activeWarnings >= t.count)
    .sort((a, b) => b.count - a.count)[0];
  if (!triggered) return null;

  return {
    action: triggered.action,
    reason: `Auto-escalation: reached ${triggered.count} active warnings.`,
    ...(triggered.durationMs !== undefined ? { durationMs: triggered.durationMs } : {}),
  };
}

interface ParsedThreshold {
  count: number;
  action: 'TIMEOUT' | 'KICK' | 'BAN';
  durationMs?: number;
}

function parseThresholds(raw: unknown): ParsedThreshold[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedThreshold[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { count?: unknown }).count === 'number' &&
      typeof (item as { action?: unknown }).action === 'string'
    ) {
      const it = item as { count: number; action: string; durationMs?: number };
      if (['TIMEOUT', 'KICK', 'BAN'].includes(it.action)) {
        out.push({
          count: it.count,
          action: it.action as ParsedThreshold['action'],
          ...(typeof it.durationMs === 'number' ? { durationMs: it.durationMs } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * Expire warnings older than the configured age by marking them inactive.
 * Run on a schedule (we call from the bot's ready event).
 */
export async function expireOldWarnings(
  prisma: PrismaClient,
  guildId: string,
): Promise<number> {
  const policy = await prisma.warningPolicy.findUnique({ where: { guildId } });
  if (!policy?.expireDays) return 0;
  const cutoff = new Date(Date.now() - policy.expireDays * 86_400_000);
  const result = await prisma.modAction.updateMany({
    where: { guildId, type: 'WARN', active: true, createdAt: { lt: cutoff } },
    data: { active: false },
  });
  return result.count;
}

export function serializeModAction(a: ModAction) {
  return {
    id: a.id,
    guildId: a.guildId,
    caseNumber: a.caseNumber,
    type: a.type,
    userId: a.userId,
    moderatorId: a.moderatorId,
    reason: a.reason,
    durationMs: a.durationMs,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    category: a.category,
    severity: a.severity,
    active: a.active,
    createdAt: a.createdAt.toISOString(),
  };
}
