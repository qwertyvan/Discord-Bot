import type { PrismaClient } from '@prisma/client';

// Collects every user-scoped row across the database for a single user, optionally
// scoped to a single guild. Used by /me/data-export for GDPR Article 15
// subject-access requests.
//
// Tables enumerated (per apps/api/prisma/schema.prisma):
//   ModAction         — moderation actions targeting the user
//   ModNote           — mod-only notes about the user
//   AuditEvent        — logged events authored by/about the user
//   AutomodHit        — automod actions taken against the user
//   MemberLevel       — XP / voice-minute accumulators
//   Balance           — economy balance
//   InventoryEntry    — purchased shop items
//   Ticket            — tickets opened by the user
//   Reminder          — user-scheduled reminders
//   Suggestion        — suggestions the user authored
//   SuggestionVote    — votes the user cast
//   UserBirthday      — birthday entries
//   EventRsvp         — event responses
//   PollVote          — poll responses
//   UserTimezone      — IANA timezone preference (global)
//   AdminAction       — dashboard mutations attributed to the user
//
// We intentionally do NOT include:
//   • Discord DMs (the bot never persists DM contents)
//   • Other users' rows
//   • Guild-wide audit log entries the requester didn't author
//   • Encrypted IntegrationCredential values (per-guild, not per-user)
export async function collectUserData(
  prisma: PrismaClient,
  userId: string,
  guildId?: string,
): Promise<Record<string, unknown>> {
  const guildScope = guildId ? { guildId } : {};

  const [
    modActions,
    modNotes,
    auditEvents,
    automodHits,
    memberLevels,
    balances,
    inventoryEntries,
    tickets,
    reminders,
    suggestions,
    suggestionVotes,
    birthdays,
    eventRsvps,
    pollVotes,
    timezone,
    adminActions,
  ] = await Promise.all([
    prisma.modAction.findMany({
      where: { userId, ...guildScope },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.modNote.findMany({
      where: { userId, ...guildScope },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditEvent.findMany({
      where: { userId, ...guildScope },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.automodHit.findMany({
      where: { userId, ...guildScope },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.memberLevel.findMany({ where: { userId, ...guildScope } }),
    prisma.balance.findMany({ where: { userId, ...guildScope } }),
    prisma.inventoryEntry.findMany({ where: { userId, ...guildScope } }),
    prisma.ticket.findMany({
      where: { userId, ...guildScope },
      orderBy: { openedAt: 'desc' },
    }),
    prisma.reminder.findMany({
      where: { userId, ...(guildId ? { guildId } : {}) },
      orderBy: { runAt: 'asc' },
    }),
    prisma.suggestion.findMany({
      where: { authorId: userId, ...guildScope },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.suggestionVote.findMany({
      where: {
        userId,
        ...(guildId ? { suggestion: { guildId } } : {}),
      },
    }),
    prisma.userBirthday.findMany({ where: { userId, ...guildScope } }),
    prisma.eventRsvp.findMany({
      where: { userId, ...(guildId ? { event: { guildId } } : {}) },
    }),
    prisma.pollVote.findMany({
      where: { userId, ...(guildId ? { poll: { guildId } } : {}) },
    }),
    prisma.userTimezone.findUnique({ where: { userId } }),
    prisma.adminAction.findMany({
      where: { userId, ...guildScope },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    userId,
    guildId: guildId ?? null,
    scope: guildId ? 'single-guild' : 'all-guilds',
    data: {
      modActions,
      modNotes,
      auditEvents,
      automodHits,
      memberLevels,
      balances,
      inventoryEntries,
      tickets,
      reminders,
      suggestions,
      suggestionVotes,
      birthdays,
      eventRsvps,
      pollVotes,
      // UserTimezone is global, not guild-scoped — included regardless.
      timezone,
      adminActions,
    },
    counts: {
      modActions: modActions.length,
      modNotes: modNotes.length,
      auditEvents: auditEvents.length,
      automodHits: automodHits.length,
      memberLevels: memberLevels.length,
      balances: balances.length,
      inventoryEntries: inventoryEntries.length,
      tickets: tickets.length,
      reminders: reminders.length,
      suggestions: suggestions.length,
      suggestionVotes: suggestionVotes.length,
      birthdays: birthdays.length,
      eventRsvps: eventRsvps.length,
      pollVotes: pollVotes.length,
      adminActions: adminActions.length,
    },
  };
}

// Single-transaction delete of every user-scoped row. Caller is responsible
// for verifying that the userId is the same one that requested the deletion
// (see routes/privacy.ts).
export async function deleteUserData(
  prisma: PrismaClient,
  userId: string,
  guildId?: string,
): Promise<Record<string, number>> {
  const guildScope = guildId ? { guildId } : {};

  return prisma.$transaction(async (tx) => {
    const modActions = await tx.modAction.deleteMany({
      where: { userId, ...guildScope },
    });
    const modNotes = await tx.modNote.deleteMany({
      where: { userId, ...guildScope },
    });
    const auditEvents = await tx.auditEvent.deleteMany({
      where: { userId, ...guildScope },
    });
    const automodHits = await tx.automodHit.deleteMany({
      where: { userId, ...guildScope },
    });
    const memberLevels = await tx.memberLevel.deleteMany({
      where: { userId, ...guildScope },
    });
    const balances = await tx.balance.deleteMany({
      where: { userId, ...guildScope },
    });
    const inventoryEntries = await tx.inventoryEntry.deleteMany({
      where: { userId, ...guildScope },
    });
    const tickets = await tx.ticket.deleteMany({
      where: { userId, ...guildScope },
    });
    const reminders = await tx.reminder.deleteMany({
      where: { userId, ...(guildId ? { guildId } : {}) },
    });
    const suggestions = await tx.suggestion.deleteMany({
      where: { authorId: userId, ...guildScope },
    });
    const suggestionVotes = await tx.suggestionVote.deleteMany({
      where: {
        userId,
        ...(guildId ? { suggestion: { guildId } } : {}),
      },
    });
    const birthdays = await tx.userBirthday.deleteMany({
      where: { userId, ...guildScope },
    });
    const eventRsvps = await tx.eventRsvp.deleteMany({
      where: { userId, ...(guildId ? { event: { guildId } } : {}) },
    });
    const pollVotes = await tx.pollVote.deleteMany({
      where: { userId, ...(guildId ? { poll: { guildId } } : {}) },
    });
    const adminActions = await tx.adminAction.deleteMany({
      where: { userId, ...guildScope },
    });
    // Timezone is global; only remove if the request isn't guild-scoped.
    let timezoneDeleted = 0;
    if (!guildId) {
      const r = await tx.userTimezone.deleteMany({ where: { userId } });
      timezoneDeleted = r.count;
    }

    return {
      modActions: modActions.count,
      modNotes: modNotes.count,
      auditEvents: auditEvents.count,
      automodHits: automodHits.count,
      memberLevels: memberLevels.count,
      balances: balances.count,
      inventoryEntries: inventoryEntries.count,
      tickets: tickets.count,
      reminders: reminders.count,
      suggestions: suggestions.count,
      suggestionVotes: suggestionVotes.count,
      birthdays: birthdays.count,
      eventRsvps: eventRsvps.count,
      pollVotes: pollVotes.count,
      adminActions: adminActions.count,
      timezone: timezoneDeleted,
    };
  });
}
