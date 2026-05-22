import type { PrismaClient } from '@prisma/client';

// Mapping from RetentionPolicy fields to the tables they govern. Each entry
// runs a deleteMany filtered by guildId + createdAt (or openedAt for tickets)
// older than `now - days`. A null/undefined horizon means "no retention" and
// is skipped.
//
// Field semantics:
//   modActionsDays  → ModAction rows
//   modLogsDays     → ModNote rows (the "private mod log")
//   transcriptDays  → closed Tickets with closeReason set (we don't store
//                     transcripts as a separate table — they live in
//                     Discord — so we prune the closed ticket *records*)
//   snapshotDays    → MessageActivity rollups
//   auditLogDays    → AuditEvent rows
//
// Returns the number of rows deleted in each bucket so the daily scheduler
// can log a tidy summary.
export interface PruneResult {
  guildId: string;
  modActions: number;
  modNotes: number;
  tickets: number;
  messageActivity: number;
  auditEvents: number;
}

export async function pruneGuild(
  prisma: PrismaClient,
  guildId: string,
): Promise<PruneResult> {
  const policy = await prisma.retentionPolicy.findUnique({ where: { guildId } });
  const result: PruneResult = {
    guildId,
    modActions: 0,
    modNotes: 0,
    tickets: 0,
    messageActivity: 0,
    auditEvents: 0,
  };
  if (!policy) return result;

  const horizon = (days: number | null): Date | null =>
    days == null ? null : new Date(Date.now() - days * 86_400_000);

  const modActionsBefore = horizon(policy.modActionsDays);
  if (modActionsBefore) {
    const r = await prisma.modAction.deleteMany({
      where: { guildId, createdAt: { lt: modActionsBefore } },
    });
    result.modActions = r.count;
  }

  const modLogsBefore = horizon(policy.modLogsDays);
  if (modLogsBefore) {
    const r = await prisma.modNote.deleteMany({
      where: { guildId, createdAt: { lt: modLogsBefore } },
    });
    result.modNotes = r.count;
  }

  const transcriptBefore = horizon(policy.transcriptDays);
  if (transcriptBefore) {
    const r = await prisma.ticket.deleteMany({
      where: {
        guildId,
        status: 'closed',
        closedAt: { lt: transcriptBefore, not: null },
      },
    });
    result.tickets = r.count;
  }

  const snapshotBefore = horizon(policy.snapshotDays);
  if (snapshotBefore) {
    // MessageActivity.date is a DATE column; lt-by-date works the same.
    const r = await prisma.messageActivity.deleteMany({
      where: { guildId, date: { lt: snapshotBefore } },
    });
    result.messageActivity = r.count;
  }

  const auditBefore = horizon(policy.auditLogDays);
  if (auditBefore) {
    const r = await prisma.auditEvent.deleteMany({
      where: { guildId, createdAt: { lt: auditBefore } },
    });
    result.auditEvents = r.count;
  }

  return result;
}
