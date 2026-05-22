import type { PrismaClient } from '@prisma/client';
import type { SnapshotPayload } from '@discord-bot/shared';

/**
 * Enumeration of guild-scoped CONFIG tables included in snapshots. The order
 * here is also the order used by restore (a `Guild` row must exist before any
 * dependents, and `ReactionRoleOption` must come after `ReactionRolePanel`).
 *
 * USER DATA tables intentionally omitted:
 *   MemberLevel, Balance, InventoryEntry, Ticket, ModAction, ModNote,
 *   AuditEvent, AutomodHit, Reminder, MessageActivity, Poll/PollOption/PollVote,
 *   PendingPost, AdminAction, UserBirthday, Event/EventRsvp, Suggestion/
 *   SuggestionVote, CaseCounter, ShortLink, UserTimezone.
 *
 * Also omitted: IntegrationCredential (envelope-encrypted secrets — exporting
 * them would leak the cleartext provider keys through the snapshot file).
 */
export const SNAPSHOT_TABLES = [
  'WelcomeConfig',
  'LoggingConfig',
  'WarningPolicy',
  'AutomodConfig',
  'VerificationConfig',
  'LevelConfig',
  'EconomyConfig',
  'TicketConfig',
  'TicketCategory',
  'ReactionRolePanel',
  'ReactionRoleOption',
  'BirthdayConfig',
  'StickyMessage',
  'CustomCommand',
  'Tag',
  'AutoResponse',
  'ShopItem',
  'IntegrationSubscription',
  'ScheduledAnnouncement',
] as const;

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

/**
 * Collect every row from each snapshot-table that belongs to `guildId`.
 * ReactionRoleOption has no `guildId` column; we fetch it via the panel join
 * and serialise the bare-row shape (no `panel` nested object).
 */
export async function collectGuildConfigSnapshot(
  prisma: PrismaClient,
  guildId: string,
): Promise<SnapshotPayload> {
  const [
    welcomeConfig,
    loggingConfig,
    warningPolicy,
    automodConfig,
    verificationConfig,
    levelConfig,
    economyConfig,
    ticketConfig,
    ticketCategory,
    reactionRolePanel,
    reactionRoleOption,
    birthdayConfig,
    stickyMessage,
    customCommand,
    tag,
    autoResponse,
    shopItem,
    integrationSubscription,
    scheduledAnnouncement,
  ] = await Promise.all([
    prisma.welcomeConfig.findMany({ where: { guildId } }),
    prisma.loggingConfig.findMany({ where: { guildId } }),
    prisma.warningPolicy.findMany({ where: { guildId } }),
    prisma.automodConfig.findMany({ where: { guildId } }),
    prisma.verificationConfig.findMany({ where: { guildId } }),
    prisma.levelConfig.findMany({ where: { guildId } }),
    prisma.economyConfig.findMany({ where: { guildId } }),
    prisma.ticketConfig.findMany({ where: { guildId } }),
    prisma.ticketCategory.findMany({ where: { guildId } }),
    prisma.reactionRolePanel.findMany({ where: { guildId } }),
    prisma.reactionRoleOption.findMany({ where: { panel: { guildId } } }),
    prisma.birthdayConfig.findMany({ where: { guildId } }),
    prisma.stickyMessage.findMany({ where: { guildId } }),
    prisma.customCommand.findMany({ where: { guildId } }),
    prisma.tag.findMany({ where: { guildId } }),
    prisma.autoResponse.findMany({ where: { guildId } }),
    prisma.shopItem.findMany({ where: { guildId } }),
    prisma.integrationSubscription.findMany({ where: { guildId } }),
    prisma.scheduledAnnouncement.findMany({ where: { guildId } }),
  ]);

  return {
    WelcomeConfig: welcomeConfig,
    LoggingConfig: loggingConfig,
    WarningPolicy: warningPolicy,
    AutomodConfig: automodConfig,
    VerificationConfig: verificationConfig,
    LevelConfig: levelConfig,
    EconomyConfig: economyConfig,
    TicketConfig: ticketConfig,
    TicketCategory: ticketCategory,
    ReactionRolePanel: reactionRolePanel,
    ReactionRoleOption: reactionRoleOption,
    BirthdayConfig: birthdayConfig,
    StickyMessage: stickyMessage,
    CustomCommand: customCommand,
    Tag: tag,
    AutoResponse: autoResponse,
    ShopItem: shopItem,
    IntegrationSubscription: integrationSubscription,
    ScheduledAnnouncement: scheduledAnnouncement,
  };
}

/**
 * Serialise the payload to JSON and return both the JSON-ready value and its
 * byte size. Dates are coerced to ISO strings via JSON.stringify's default
 * Date handling, which round-trips through Prisma on restore.
 */
export function serializeSnapshotPayload(
  payload: SnapshotPayload,
): { json: SnapshotPayload; sizeBytes: number } {
  const text = JSON.stringify(payload);
  // Re-parse so the persisted JSON column contains ISO date strings rather
  // than Date instances — keeps the row size accurate and avoids surprises if
  // the JSON column type ever changes.
  const json = JSON.parse(text) as SnapshotPayload;
  return { json, sizeBytes: Buffer.byteLength(text, 'utf8') };
}
