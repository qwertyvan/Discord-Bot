import { request } from 'undici';
import { env } from './env.js';
import type {
  AuditEventType,
  AutomodConfig,
  AutomodHit,
  AutoResponse,
  CreateAuditEventInput,
  CreateAutomodHitInput,
  CreateAutoResponseInput,
  CreateModActionInput,
  CreateModNoteInput,
  CreatePollInput,
  CreateReminderInput,
  CreateTagInput,
  LoggingConfig,
  ModAction,
  ModActionType,
  ModNote,
  Poll,
  ReactionRolePanel,
  Reminder,
  Tag,
  UpdateAutoResponseInput,
  UpdateTagInput,
  VerificationConfig,
  UpdateVerificationConfigInput,
  WarningPolicy,
  WelcomeConfig,
  UpdateWelcomeConfigInput,
  LevelConfig,
  UpdateLevelConfigInput,
  Balance,
  EconomyConfig,
  InventoryEntry,
  ShopItem,
  CreateShopItemInput,
  CreateTicketCategoryInput,
  CreateTicketInput,
  Ticket,
  TicketCategory,
  TicketConfig,
  UpdateTicketConfigInput,
  UpdateTicketInput,
  ScheduledAnnouncement,
  CreateScheduledAnnouncementInput,
  BirthdayConfig,
  UpdateBirthdayConfigInput,
  UserBirthday,
  SetUserBirthdayInput,
  Event as GuildEvent,
  CreateEventInput,
  CustomCommand,
  CreateCustomCommandInput,
  UpdateCustomCommandInput,
  StickyMessage,
  UpsertStickyMessageInput,
  Suggestion,
  CreateSuggestionInput,
  ReviewSuggestionInput,
  EmbedBuilderInput,
  VoiceHubChannel,
  UpsertVoiceHubInput,
  VoiceSession,
  StartVoiceSessionInput,
  VoiceClaim,
  VoiceClaimConfig,
  VoiceClaimableChannel,
  CreateVoiceClaimInput,
  CreateVoiceClaimableChannelInput,
  UpdateVoiceClaimInput,
  UpsertVoiceClaimConfigInput,
  SoundboardClip,
  UpsertSoundboardClipInput,
  TtsConfig,
  UpsertTtsConfigInput,
  ActivityEventsBatchInput,
  InsightsSummary,
  ActivityRoleRule,
  UpsertActivityRoleRuleInput,
  InactivityPrunePolicy,
  UpsertPolicyInput,
  MemberActivity,
  MemberActivityBatchEntry,
  PruneCandidate,
  TriviaQuestion,
  TriviaScore,
  CreateTriviaQuestionInput,
  HangmanGame,
  CreateHangmanGameInput,
  UpdateHangmanGameInput,
  RpsRecord,
  RpsChallenge,
  CreateRpsChallengeInput,
  RespondRpsChallengeInput,
  ResolveRpsChallengeResult,
  ClaimDailyResult,
  ConfigSnapshot,
  ConfigSnapshotDetail,
  CreateSnapshotInput,
  SnapshotPolicy,
  UpsertSnapshotPolicyInput,
  Appeal,
  AppealSlaConfig,
  AppealStatus,
  CreateAppealInput,
  ReviewAppealInput,
  UpsertAppealSlaConfigInput,
  UpsertLadderStepInput,
  WarningLadderStep,
  OutboundWebhook,
  CreateOutboundWebhookInput,
  UpdateOutboundWebhookInput,
  WebhookDelivery,
  PublicApiToken,
  CreatePublicApiTokenInput,
  AddTrackInput,
  LoopMode,
  MoveTrackInput,
  MusicQueue,
  MusicTrack,
  SetQueueStateInput,
  Giveaway,
  CreateGiveawayInput,
  EnterGiveawayInput,
  GiveawayStatus,
  StarboardConfig,
  UpsertStarboardConfigInput,
  StarboardEntry,
  RecordStarInput,
  CounterChannel,
  UpsertCounterChannelInput,
  VanityRole,
  VanityRoleKind,
  UpsertVanityRoleInput,
  CreateFeedSubscriptionInput,
  FeedKind,
  FeedSubscription,
  ForumAutoTag,
  UpsertForumAutoTagInput,
  StaleThreadPolicy,
  UpsertStalePolicyInput,
  StageScheduledEvent,
  CreateStageEventInput,
  StageEventStatus,
  AntiRaidConfig,
  UpsertAntiRaidConfigInput,
  LockdownEvent,
  PendingVerification,
  CreatePendingVerificationInput,
  VerifyChallengeInput,
  VerifyChallengeResult,
  Report,
  CreateReportInput,
  ReportAction,
  ReportStatus,
  ServerTemplate,
  CreateTemplateInput,
  TemplateDiff,
  TemplatePayload,
  RetentionPolicy,
  UpsertRetentionPolicyInput,
  InviteCode,
  UpsertInviteCodeInput,
  InviterLeaderboardEntry,
  MemberInvite,
  CreateMemberInviteInput,
  UpdateMemberInviteInput,
  InviteGatedRole,
  UpsertInviteGatedRoleInput,
  AutoReactionRule,
  CreateAutoReactionRuleInput,
  UpdateAutoReactionRuleInput,
  Quote,
  QuoteConfig,
  CreateQuoteInput,
  UpsertQuoteConfigInput,
  MilestoneConfig,
  UpsertMilestoneConfigInput,
  TenureRoleRule,
  UpsertTenureRoleRuleInput,
  MilestoneAward,
  MilestoneAwardKind,
  CreateMilestoneAwardInput,
  QuestTemplate,
  CreateQuestTemplateInput,
  UpdateQuestTemplateInput,
  UserQuest,
  ProgressEvent,
  Application,
  ApplicationStatus,
  CreateApplicationInput,
  OnboardingForm,
  ReviewApplicationInput,
  UpsertOnboardingFormInput,
  LinkSafetyConfig,
  UpsertLinkSafetyConfigInput,
  LinkDomain,
  CreateLinkDomainInput,
  LinkDomainKind,
  ShopItemExt,
  UpsertShopItemInput,
  InventoryEntryExt,
  GiftRequest,
  ConsumeItemInput,
  ConsumeItemResult,
  BetRequest,
  DiceRequest,
  BlackjackState,
  SlotsResult,
  DiceResult,
  LootDrop,
  UpsertLootDropInput,
  LootClaimResult,
  KaraokeNight,
  CreateKaraokeNightInput,
  UpdateKaraokeNightInput,
  KaraokeNightStatus,
  KaraokeSong,
  CreateKaraokeSongInput,
  UpdateKaraokeSongInput,
  UpsertKaraokeRsvpInput,
  ServerPet,
  UpsertPetNameInput,
  PetActionResult,
  TopFeederResponse,
  ProfileBadge,
  CreateProfileBadgeInput,
  UserProfile,
  UpsertUserProfileInput,
  UserBadge,
  GrantUserBadgeInput,
  Achievement,
  AchievementKind,
  CreateAchievementInput,
  UpdateAchievementInput,
  UserAchievement,
  AwardAchievementInput,
  AwardAchievementResult,
  MarketListing,
  MarketConfig,
  CreateListingInput,
  UpsertMarketConfigInput,
  MarketListingStatus,
  Auction,
  AuctionBid,
  AuctionStatus,
  CreateAuctionInput,
  PlaceBidInput,
  FishingSkill,
  FishingDrop,
  CreateFishingDropInput,
  FishingCast,
  CastResult,
} from '@discord-bot/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function call<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(path, env.API_BASE_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await request(url, {
    method: opts.method ?? 'GET',
    headers: {
      authorization: `Bearer ${env.BOT_API_TOKEN}`,
      'content-type': 'application/json',
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });

  if (res.statusCode === 204) return undefined as T;

  const text = await res.body.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (res.statusCode >= 400) {
    const err = json as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiError(
      res.statusCode,
      err?.error?.code ?? 'unknown',
      err?.error?.message ?? `HTTP ${res.statusCode}`,
    );
  }
  return json as T;
}

export interface CreateModActionResult {
  action: ModAction;
  triggeredEscalation: {
    action: 'TIMEOUT' | 'KICK' | 'BAN';
    durationMs?: number;
    reason: string;
  } | null;
}

export const api = {
  // Guild registry
  upsertGuild: (id: string, body: { name: string; iconUrl: string | null }) =>
    call<{ id: string; name: string; iconUrl: string | null; addedAt: string }>(`/guilds/${id}`, {
      method: 'PUT',
      body,
    }),
  deleteGuild: (id: string) => call<void>(`/guilds/${id}`, { method: 'DELETE' }),

  // Mod actions — unified entry point for warn/kick/ban/timeout/etc.
  createModAction: (guildId: string, body: CreateModActionInput) =>
    call<CreateModActionResult>(`/guilds/${guildId}/mod-actions`, { method: 'POST', body }),
  listModActions: (
    guildId: string,
    query?: { userId?: string; type?: ModActionType; limit?: number },
  ) =>
    call<{ actions: ModAction[]; nextCursor: string | null }>(
      `/guilds/${guildId}/mod-actions`,
      query ? { query } : {},
    ),
  getCase: (guildId: string, caseNumber: number) =>
    call<ModAction>(`/guilds/${guildId}/mod-actions/case/${caseNumber}`),
  deleteModAction: (guildId: string, actionId: string) =>
    call<void>(`/guilds/${guildId}/mod-actions/${actionId}`, { method: 'DELETE' }),

  // Mod notes
  createModNote: (guildId: string, body: CreateModNoteInput) =>
    call<ModNote>(`/guilds/${guildId}/mod-notes`, { method: 'POST', body }),
  listModNotes: (guildId: string, userId: string) =>
    call<{ notes: ModNote[] }>(`/guilds/${guildId}/users/${userId}/mod-notes`),
  deleteModNote: (guildId: string, noteId: string) =>
    call<void>(`/guilds/${guildId}/mod-notes/${noteId}`, { method: 'DELETE' }),

  // Combined history (mod actions + notes for one user)
  getUserHistory: (
    guildId: string,
    userId: string,
    query?: { limit?: number; types?: ModActionType[] },
  ) =>
    call<{ actions: ModAction[]; notes: ModNote[] }>(
      `/guilds/${guildId}/users/${userId}/history`,
      query
        ? {
            query: {
              ...(query.limit !== undefined ? { limit: query.limit } : {}),
              ...(query.types && query.types.length ? { types: query.types.join(',') } : {}),
            },
          }
        : {},
    ),

  // Warning policy
  getWarningPolicy: (guildId: string) => call<WarningPolicy>(`/guilds/${guildId}/warning-policy`),

  // Audit events / logging
  createAuditEvent: (guildId: string, body: CreateAuditEventInput) =>
    call<{
      id: string;
      guildId: string;
      type: AuditEventType;
      userId: string | null;
      channelId: string | null;
      payload: Record<string, unknown>;
      createdAt: string;
    }>(`/guilds/${guildId}/audit-events`, { method: 'POST', body }),
  getLoggingConfig: (guildId: string) => call<LoggingConfig>(`/guilds/${guildId}/logging-config`),

  // Welcome config
  getWelcomeConfig: (guildId: string) => call<WelcomeConfig>(`/guilds/${guildId}/welcome`),
  updateWelcomeConfig: (guildId: string, body: UpdateWelcomeConfigInput) =>
    call<WelcomeConfig>(`/guilds/${guildId}/welcome`, { method: 'PUT', body }),

  // Automod
  getAutomodConfig: (guildId: string) => call<AutomodConfig>(`/guilds/${guildId}/automod-config`),
  createAutomodHit: (guildId: string, body: CreateAutomodHitInput) =>
    call<AutomodHit>(`/guilds/${guildId}/automod-hits`, { method: 'POST', body }),

  // Verification
  getVerificationConfig: (guildId: string) =>
    call<VerificationConfig>(`/guilds/${guildId}/verification`),
  updateVerificationConfig: (guildId: string, body: UpdateVerificationConfigInput) =>
    call<VerificationConfig>(`/guilds/${guildId}/verification`, { method: 'PUT', body }),

  // Reaction-role panels
  listReactionRolePanels: (guildId: string) =>
    call<{ panels: ReactionRolePanel[] }>(`/guilds/${guildId}/reaction-role-panels`),
  getReactionRolePanel: (guildId: string, panelId: string) =>
    call<ReactionRolePanel>(`/guilds/${guildId}/reaction-role-panels/${panelId}`),
  updateReactionRolePanel: (
    guildId: string,
    panelId: string,
    body: { messageId?: string | null },
  ) =>
    call<ReactionRolePanel>(`/guilds/${guildId}/reaction-role-panels/${panelId}`, {
      method: 'PATCH',
      body,
    }),

  // Polls
  createPoll: (guildId: string, body: CreatePollInput) =>
    call<Poll>(`/guilds/${guildId}/polls`, { method: 'POST', body }),
  getPoll: (guildId: string, pollId: string) => call<Poll>(`/guilds/${guildId}/polls/${pollId}`),
  updatePoll: (
    guildId: string,
    pollId: string,
    body: { messageId?: string | null; close?: boolean },
  ) => call<Poll>(`/guilds/${guildId}/polls/${pollId}`, { method: 'PATCH', body }),
  votePoll: (guildId: string, pollId: string, body: { userId: string; optionIds: string[] }) =>
    call<Poll>(`/guilds/${guildId}/polls/${pollId}/vote`, { method: 'POST', body }),
  duePolls: () => call<{ polls: Poll[] }>(`/polls/due`),

  // Reminders
  createReminder: (body: CreateReminderInput) =>
    call<Reminder>(`/reminders`, { method: 'POST', body }),
  listReminders: (userId: string) => call<{ reminders: Reminder[] }>(`/users/${userId}/reminders`),
  deleteReminder: (reminderId: string) =>
    call<void>(`/reminders/${reminderId}`, { method: 'DELETE' }),
  dueReminders: () => call<{ reminders: Reminder[] }>(`/reminders/due`),

  // Tags
  listTags: (guildId: string) => call<{ tags: Tag[] }>(`/guilds/${guildId}/tags`),
  getTag: (guildId: string, name: string) =>
    call<Tag>(`/guilds/${guildId}/tags/${encodeURIComponent(name)}`),
  createTag: (guildId: string, body: CreateTagInput) =>
    call<Tag>(`/guilds/${guildId}/tags`, { method: 'POST', body }),
  updateTag: (guildId: string, name: string, body: UpdateTagInput) =>
    call<Tag>(`/guilds/${guildId}/tags/${encodeURIComponent(name)}`, { method: 'PATCH', body }),
  deleteTag: (guildId: string, name: string) =>
    call<void>(`/guilds/${guildId}/tags/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  touchTag: (guildId: string, name: string) =>
    call<Tag>(`/guilds/${guildId}/tags/${encodeURIComponent(name)}/touch`, { method: 'POST' }),

  // Auto-responses
  listAutoResponses: (guildId: string) =>
    call<{ autoResponses: AutoResponse[] }>(`/guilds/${guildId}/auto-responses`),
  createAutoResponse: (guildId: string, body: CreateAutoResponseInput) =>
    call<AutoResponse>(`/guilds/${guildId}/auto-responses`, { method: 'POST', body }),
  updateAutoResponse: (guildId: string, id: string, body: UpdateAutoResponseInput) =>
    call<AutoResponse>(`/guilds/${guildId}/auto-responses/${id}`, { method: 'PATCH', body }),
  deleteAutoResponse: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/auto-responses/${id}`, { method: 'DELETE' }),

  // Auto-reactions
  listAutoReactionRules: (guildId: string) =>
    call<{ rules: AutoReactionRule[] }>(`/guilds/${guildId}/auto-reactions`),
  getEnabledAutoReactionRules: (guildId: string) =>
    call<{ rules: AutoReactionRule[] }>(`/guilds/${guildId}/auto-reactions/enabled`),
  createAutoReactionRule: (guildId: string, body: CreateAutoReactionRuleInput) =>
    call<AutoReactionRule>(`/guilds/${guildId}/auto-reactions`, { method: 'POST', body }),
  updateAutoReactionRule: (guildId: string, id: string, body: UpdateAutoReactionRuleInput) =>
    call<AutoReactionRule>(`/guilds/${guildId}/auto-reactions/${id}`, { method: 'PATCH', body }),
  deleteAutoReactionRule: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/auto-reactions/${id}`, { method: 'DELETE' }),

  // Leveling
  getLevelConfig: (guildId: string) => call<LevelConfig>(`/guilds/${guildId}/level-config`),
  updateLevelConfig: (guildId: string, body: UpdateLevelConfigInput) =>
    call<LevelConfig>(`/guilds/${guildId}/level-config`, { method: 'PUT', body }),
  awardTextXp: (guildId: string, body: { userId: string; channelId: string }) =>
    call<{
      applied: boolean;
      xp: number;
      level: number;
      previousLevel: number;
      leveledUp: boolean;
    }>(`/guilds/${guildId}/level/award`, { method: 'POST', body }),
  awardVoiceXp: (guildId: string, body: { userId: string; minutes: number }) =>
    call<{
      applied: boolean;
      xp: number;
      level: number;
      previousLevel: number;
      leveledUp: boolean;
    }>(`/guilds/${guildId}/level/voice`, { method: 'POST', body }),
  getMemberLevel: (guildId: string, userId: string) =>
    call<{
      guildId: string;
      userId: string;
      xp: number;
      voiceMinutes: number;
      level: number;
      rank: number | null;
      currentLevelXp: number;
      nextLevelXp: number;
    }>(`/guilds/${guildId}/level/${userId}`),
  getLeaderboard: (guildId: string, limit = 25) =>
    call<{
      entries: Array<{
        rank: number;
        guildId: string;
        userId: string;
        xp: number;
        voiceMinutes: number;
        level: number;
      }>;
    }>(`/guilds/${guildId}/leaderboard`, { query: { limit } }),
  giveXp: (guildId: string, userId: string, amount: number) =>
    call<{ guildId: string; userId: string; xp: number; level: number }>(
      `/guilds/${guildId}/level/${userId}/give`,
      { method: 'POST', body: { amount } },
    ),
  resetXp: (guildId: string, userId: string) =>
    call<void>(`/guilds/${guildId}/level/${userId}`, { method: 'DELETE' }),

  // Economy
  getEconomyConfig: (guildId: string) => call<EconomyConfig>(`/guilds/${guildId}/economy-config`),
  getBalance: (guildId: string, userId: string) =>
    call<Balance>(`/guilds/${guildId}/balance/${userId}`),
  claimDaily: (guildId: string, userId: string) =>
    call<Balance & { reward: number }>(`/guilds/${guildId}/balance/${userId}/daily`, {
      method: 'POST',
    }),
  doWork: (guildId: string, userId: string) =>
    call<Balance & { reward: number }>(`/guilds/${guildId}/balance/${userId}/work`, {
      method: 'POST',
    }),
  transfer: (guildId: string, fromUserId: string, toUserId: string, amount: number) =>
    call<{ ok: boolean; amount: number }>(`/guilds/${guildId}/balance/${fromUserId}/transfer`, {
      method: 'POST',
      body: { toUserId, amount },
    }),
  adjustBalance: (guildId: string, userId: string, delta: number) =>
    call<Balance>(`/guilds/${guildId}/balance/${userId}/adjust`, {
      method: 'POST',
      body: { delta },
    }),
  gamble: (guildId: string, userId: string, body: { stake: number; game: 'coinflip' | 'slots' }) =>
    call<
      Balance & {
        delta: number;
        game: 'coinflip' | 'slots';
        outcome?: 'heads' | 'tails';
        win?: boolean;
        reels?: string[];
        multiplier?: number;
      }
    >(`/guilds/${guildId}/balance/${userId}/gamble`, { method: 'POST', body }),
  listShop: (guildId: string) => call<{ items: ShopItem[] }>(`/guilds/${guildId}/shop`),
  createShopItem: (guildId: string, body: CreateShopItemInput) =>
    call<ShopItem>(`/guilds/${guildId}/shop`, { method: 'POST', body }),
  deleteShopItem: (guildId: string, itemId: string) =>
    call<void>(`/guilds/${guildId}/shop/${itemId}`, { method: 'DELETE' }),
  buyShopItem: (guildId: string, itemId: string, userId: string) =>
    call<{ item: ShopItem; balance: Balance; inventoryEntry: InventoryEntry }>(
      `/guilds/${guildId}/shop/${itemId}/buy`,
      { method: 'POST', body: { userId } },
    ),
  listInventory: (guildId: string, userId: string) =>
    call<{ entries: InventoryEntry[] }>(`/guilds/${guildId}/inventory/${userId}`),
  economyLeaderboard: (guildId: string, limit = 25) =>
    call<{
      entries: Array<{ rank: number; guildId: string; userId: string; amount: number }>;
    }>(`/guilds/${guildId}/economy-leaderboard`, { query: { limit } }),

  // Tickets
  getTicketConfig: (guildId: string) => call<TicketConfig>(`/guilds/${guildId}/ticket-config`),
  updateTicketConfig: (guildId: string, body: UpdateTicketConfigInput) =>
    call<TicketConfig>(`/guilds/${guildId}/ticket-config`, { method: 'PUT', body }),
  listTicketCategories: (guildId: string) =>
    call<{ categories: TicketCategory[] }>(`/guilds/${guildId}/ticket-categories`),
  createTicketCategory: (guildId: string, body: CreateTicketCategoryInput) =>
    call<TicketCategory>(`/guilds/${guildId}/ticket-categories`, { method: 'POST', body }),
  deleteTicketCategory: (guildId: string, categoryId: string) =>
    call<void>(`/guilds/${guildId}/ticket-categories/${categoryId}`, { method: 'DELETE' }),
  createTicket: (guildId: string, body: CreateTicketInput) =>
    call<Ticket>(`/guilds/${guildId}/tickets`, { method: 'POST', body }),
  getTicket: (guildId: string, ticketId: string) =>
    call<Ticket>(`/guilds/${guildId}/tickets/${ticketId}`),
  getTicketByChannel: (guildId: string, channelId: string) =>
    call<Ticket>(`/guilds/${guildId}/tickets/by-channel/${channelId}`),
  updateTicket: (guildId: string, ticketId: string, body: UpdateTicketInput) =>
    call<Ticket>(`/guilds/${guildId}/tickets/${ticketId}`, { method: 'PATCH', body }),
  listTickets: (
    guildId: string,
    query?: { status?: 'open' | 'closed'; userId?: string; limit?: number },
  ) => call<{ tickets: Ticket[] }>(`/guilds/${guildId}/tickets`, query ? { query } : {}),
  bumpTicketActivity: (guildId: string, channelId: string) =>
    call<void>(`/guilds/${guildId}/tickets/by-channel/${channelId}/activity`, { method: 'POST' }),
  slaDueTickets: () =>
    call<{ tickets: Array<Ticket & { staffRoleId: string | null }> }>(`/tickets/sla-due`),
  markSlaReminderSent: (ticketId: string) =>
    call<void>(`/tickets/${ticketId}/sla-reminder-sent`, { method: 'POST' }),
  idleDueTickets: () =>
    call<{
      tickets: Array<Ticket & { transcriptsEnabled: boolean; transcriptChannelId: string | null }>;
    }>(`/tickets/idle-due`),
  getTicketStats: (guildId: string) =>
    call<{
      guildId: string;
      openCount: number;
      closedCount: number;
      openedLast7d: number;
      closedLast7d: number;
      avgResolutionSeconds: number;
    }>(`/guilds/${guildId}/tickets/stats`),

  // Message activity flush
  flushMessageActivity: (
    guildId: string,
    entries: Array<{ channelId: string; date: string; hour: number; count: number }>,
  ) =>
    call<{ ok: boolean; count: number }>(`/guilds/${guildId}/message-activity`, {
      method: 'POST',
      body: { entries },
    }),

  // Integrations
  dueRssIntegrations: (limit = 20) =>
    call<{
      integrations: Array<{
        id: string;
        guildId: string;
        channelId: string;
        name: string;
        rssUrl: string | null;
        lastSeenGuid: string | null;
        pollInterval: number;
      }>;
    }>(`/rss/due`, { query: { limit } }),
  updateRssState: (integrationId: string, body: { lastSeenGuid?: string | null }) =>
    call<unknown>(`/integrations/${integrationId}/rss-state`, { method: 'POST', body }),
  duePosts: (limit = 50) =>
    call<{
      posts: Array<{
        id: string;
        guildId: string;
        channelId: string;
        content: string | null;
        embedJson: Record<string, unknown> | null;
        source: string | null;
        createdAt: string;
      }>;
    }>(`/posts/due`, { query: { limit } }),
  createPendingPost: (body: {
    guildId: string;
    channelId: string;
    content?: string;
    embedJson?: unknown;
    source?: string;
  }) => call<{ id: string }>(`/posts`, { method: 'POST', body }),
  deletePost: (postId: string) => call<void>(`/posts/${postId}`, { method: 'DELETE' }),

  // Twitch
  dueTwitchIntegrations: (limit = 20) =>
    call<{
      integrations: Array<{
        id: string;
        guildId: string;
        channelId: string;
        name: string;
        twitchUsername: string | null;
        lastSeenGuid: string | null;
        pollInterval: number;
      }>;
    }>(`/twitch/due`, { query: { limit } }),
  updateTwitchState: (integrationId: string, body: { streamId?: string | null }) =>
    call<unknown>(`/integrations/${integrationId}/twitch-state`, { method: 'POST', body }),

  // Integration credentials (bot-side read; admin manages writes via session)
  getIntegrationCredential: (guildId: string, provider: string, key: string) =>
    call<{ provider: string; key: string; value: string }>(
      `/guilds/${guildId}/integration-credentials/${provider}/${key}/value`,
    ),

  // Custom commands
  listCustomCommands: (guildId: string) =>
    call<{ commands: CustomCommand[] }>(`/guilds/${guildId}/custom-commands`),
  getCustomCommand: (guildId: string, name: string) =>
    call<CustomCommand>(`/guilds/${guildId}/custom-commands/${encodeURIComponent(name)}`),
  createCustomCommand: (guildId: string, body: CreateCustomCommandInput) =>
    call<CustomCommand>(`/guilds/${guildId}/custom-commands`, { method: 'POST', body }),
  updateCustomCommand: (guildId: string, name: string, body: UpdateCustomCommandInput) =>
    call<CustomCommand>(`/guilds/${guildId}/custom-commands/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body,
    }),
  deleteCustomCommand: (guildId: string, name: string) =>
    call<void>(`/guilds/${guildId}/custom-commands/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  touchCustomCommand: (guildId: string, name: string) =>
    call<CustomCommand>(`/guilds/${guildId}/custom-commands/${encodeURIComponent(name)}/touch`, {
      method: 'POST',
    }),

  // User timezone
  getUserTimezone: (userId: string) =>
    call<{ userId: string; tz: string | null }>(`/users/${userId}/timezone`),
  setUserTimezone: (userId: string, tz: string) =>
    call<{ userId: string; tz: string }>(`/users/${userId}/timezone`, {
      method: 'PUT',
      body: { tz },
    }),
  clearUserTimezone: (userId: string) =>
    call<void>(`/users/${userId}/timezone`, { method: 'DELETE' }),

  // Scheduled announcements
  listAnnouncements: (guildId: string) =>
    call<{ announcements: ScheduledAnnouncement[] }>(`/guilds/${guildId}/announcements`),
  createAnnouncement: (guildId: string, body: CreateScheduledAnnouncementInput) =>
    call<ScheduledAnnouncement>(`/guilds/${guildId}/announcements`, { method: 'POST', body }),
  deleteAnnouncement: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/announcements/${id}`, { method: 'DELETE' }),
  dueAnnouncements: () => call<{ announcements: ScheduledAnnouncement[] }>(`/announcements/due`),
  advanceAnnouncement: (id: string) =>
    call<unknown>(`/announcements/${id}/advance`, { method: 'POST' }),

  // Birthdays
  getBirthdayConfig: (guildId: string) =>
    call<BirthdayConfig>(`/guilds/${guildId}/birthday-config`),
  updateBirthdayConfig: (guildId: string, body: UpdateBirthdayConfigInput) =>
    call<BirthdayConfig>(`/guilds/${guildId}/birthday-config`, { method: 'PUT', body }),
  setBirthday: (guildId: string, userId: string, body: SetUserBirthdayInput) =>
    call<UserBirthday>(`/guilds/${guildId}/users/${userId}/birthday`, { method: 'PUT', body }),
  getBirthday: (guildId: string, userId: string) =>
    call<UserBirthday | null>(`/guilds/${guildId}/users/${userId}/birthday`),
  clearBirthday: (guildId: string, userId: string) =>
    call<void>(`/guilds/${guildId}/users/${userId}/birthday`, { method: 'DELETE' }),
  pollBirthdays: (guildId: string) =>
    call<{
      fired: boolean;
      channelId?: string;
      template?: string;
      birthdays: Array<{ userId: string; month: number; day: number; year: number | null }>;
    }>(`/guilds/${guildId}/birthdays/poll`, { method: 'POST' }),

  // Events
  listEvents: (guildId: string, query?: { upcoming?: boolean; limit?: number }) =>
    call<{ events: GuildEvent[] }>(
      `/guilds/${guildId}/events`,
      query
        ? {
            query: {
              ...(query.upcoming ? { upcoming: 1 } : {}),
              ...(query.limit !== undefined ? { limit: query.limit } : {}),
            },
          }
        : {},
    ),
  createEvent: (guildId: string, body: CreateEventInput) =>
    call<GuildEvent>(`/guilds/${guildId}/events`, { method: 'POST', body }),
  getEvent: (guildId: string, eventId: string) =>
    call<GuildEvent>(`/guilds/${guildId}/events/${eventId}`),
  updateEvent: (guildId: string, eventId: string, body: { messageId?: string | null }) =>
    call<GuildEvent>(`/guilds/${guildId}/events/${eventId}`, { method: 'PATCH', body }),
  deleteEvent: (guildId: string, eventId: string) =>
    call<void>(`/guilds/${guildId}/events/${eventId}`, { method: 'DELETE' }),
  rsvpEvent: (
    guildId: string,
    eventId: string,
    body: { userId: string; status: 'yes' | 'maybe' | 'no' },
  ) => call<GuildEvent>(`/guilds/${guildId}/events/${eventId}/rsvp`, { method: 'POST', body }),

  // Sticky messages
  listStickyMessages: (guildId: string) =>
    call<{ sticky: StickyMessage[] }>(`/guilds/${guildId}/sticky-messages`),
  getStickyMessage: (guildId: string, channelId: string) =>
    call<StickyMessage>(`/guilds/${guildId}/sticky-messages/${channelId}`),
  upsertStickyMessage: (guildId: string, body: UpsertStickyMessageInput) =>
    call<StickyMessage>(`/guilds/${guildId}/sticky-messages`, { method: 'PUT', body }),
  updateStickyLastMessage: (
    guildId: string,
    channelId: string,
    body: { lastMessageId: string | null },
  ) =>
    call<StickyMessage>(`/guilds/${guildId}/sticky-messages/${channelId}`, {
      method: 'PATCH',
      body,
    }),
  deleteStickyMessage: (guildId: string, channelId: string) =>
    call<void>(`/guilds/${guildId}/sticky-messages/${channelId}`, { method: 'DELETE' }),

  // Suggestions
  listSuggestions: (
    guildId: string,
    query?: { status?: 'open' | 'accepted' | 'rejected' | 'implemented'; limit?: number },
  ) =>
    call<{ suggestions: Suggestion[] }>(`/guilds/${guildId}/suggestions`, query ? { query } : {}),
  getSuggestion: (guildId: string, suggestionId: string) =>
    call<Suggestion>(`/guilds/${guildId}/suggestions/${suggestionId}`),
  createSuggestion: (guildId: string, body: CreateSuggestionInput) =>
    call<Suggestion>(`/guilds/${guildId}/suggestions`, { method: 'POST', body }),
  updateSuggestion: (guildId: string, suggestionId: string, body: { messageId?: string | null }) =>
    call<Suggestion>(`/guilds/${guildId}/suggestions/${suggestionId}`, { method: 'PATCH', body }),
  reviewSuggestion: (guildId: string, suggestionId: string, body: ReviewSuggestionInput) =>
    call<Suggestion>(`/guilds/${guildId}/suggestions/${suggestionId}/review`, {
      method: 'POST',
      body,
    }),
  voteSuggestion: (guildId: string, suggestionId: string, body: { userId: string; vote: number }) =>
    call<Suggestion>(`/guilds/${guildId}/suggestions/${suggestionId}/vote`, {
      method: 'POST',
      body,
    }),

  // Quotes
  getQuoteConfig: (guildId: string) =>
    call<QuoteConfig>(`/guilds/${guildId}/quote-config`),
  upsertQuoteConfig: (guildId: string, body: UpsertQuoteConfigInput) =>
    call<QuoteConfig>(`/guilds/${guildId}/quote-config`, { method: 'PUT', body }),
  listQuotes: (
    guildId: string,
    query?: { authorId?: string; savedBy?: string; search?: string; limit?: number; offset?: number },
  ) =>
    call<{ quotes: Quote[]; total: number }>(
      `/guilds/${guildId}/quotes`,
      query
        ? {
            query: {
              ...(query.authorId !== undefined ? { authorId: query.authorId } : {}),
              ...(query.savedBy !== undefined ? { savedBy: query.savedBy } : {}),
              ...(query.search !== undefined ? { search: query.search } : {}),
              ...(query.limit !== undefined ? { limit: query.limit } : {}),
              ...(query.offset !== undefined ? { offset: query.offset } : {}),
            },
          }
        : {},
    ),
  getRandomQuote: (guildId: string, authorId?: string) =>
    call<Quote>(
      `/guilds/${guildId}/quotes/random`,
      authorId ? { query: { authorId } } : {},
    ),
  getQuote: (guildId: string, quoteId: string) =>
    call<Quote>(`/guilds/${guildId}/quotes/${quoteId}`),
  createQuote: (guildId: string, body: CreateQuoteInput) =>
    call<Quote>(`/guilds/${guildId}/quotes`, { method: 'POST', body }),
  updateQuoteReactionCount: (guildId: string, quoteId: string, reactionCount: number) =>
    call<Quote>(`/guilds/${guildId}/quotes/${quoteId}`, {
      method: 'PATCH',
      body: { reactionCount },
    }),
  deleteQuote: (
    guildId: string,
    quoteId: string,
    query: { requesterId: string; force?: boolean },
  ) =>
    call<void>(`/guilds/${guildId}/quotes/${quoteId}`, {
      method: 'DELETE',
      query: {
        requesterId: query.requesterId,
        ...(query.force ? { force: '1' } : {}),
      },
    }),
  topQuotes: (guildId: string, query?: { days?: number; limit?: number }) =>
    call<{ quotes: Quote[] }>(
      `/guilds/${guildId}/quotes/top`,
      query
        ? {
            query: {
              ...(query.days !== undefined ? { days: query.days } : {}),
              ...(query.limit !== undefined ? { limit: query.limit } : {}),
            },
          }
        : {},
    ),

  // Custom embed builder
  postEmbed: (guildId: string, body: EmbedBuilderInput) =>
    call<{ id: string }>(`/guilds/${guildId}/post-embed`, { method: 'POST', body }),

  // Voice hubs & sessions
  listVoiceHubs: (guildId: string) =>
    call<{ hubs: VoiceHubChannel[] }>(`/guilds/${guildId}/voice-hubs`),
  upsertVoiceHub: (guildId: string, body: UpsertVoiceHubInput) =>
    call<VoiceHubChannel>(`/guilds/${guildId}/voice-hubs`, { method: 'POST', body }),
  deleteVoiceHub: (guildId: string, channelId: string) =>
    call<void>(`/guilds/${guildId}/voice-hubs/${channelId}`, { method: 'DELETE' }),
  startVoiceSession: (guildId: string, body: StartVoiceSessionInput) =>
    call<VoiceSession>(`/guilds/${guildId}/voice-sessions/start`, { method: 'POST', body }),
  endVoiceSession: (guildId: string, sessionId: string) =>
    call<VoiceSession>(`/guilds/${guildId}/voice-sessions/${sessionId}/end`, { method: 'POST' }),
  activeVoiceSessions: () => call<{ sessions: VoiceSession[] }>(`/voice-sessions/active`),

  // Voice claiming (per-channel ownership)
  getVoiceClaimConfig: (guildId: string) =>
    call<VoiceClaimConfig>(`/guilds/${guildId}/voice-claim-config`),
  upsertVoiceClaimConfig: (guildId: string, body: UpsertVoiceClaimConfigInput) =>
    call<VoiceClaimConfig>(`/guilds/${guildId}/voice-claim-config`, {
      method: 'PUT',
      body,
    }),
  listVoiceClaimable: (guildId: string) =>
    call<{ channels: VoiceClaimableChannel[] }>(`/guilds/${guildId}/voice-claimable`),
  addVoiceClaimable: (guildId: string, body: CreateVoiceClaimableChannelInput) =>
    call<VoiceClaimableChannel>(`/guilds/${guildId}/voice-claimable`, {
      method: 'POST',
      body,
    }),
  removeVoiceClaimable: (guildId: string, channelId: string) =>
    call<void>(`/guilds/${guildId}/voice-claimable/${channelId}`, { method: 'DELETE' }),
  listVoiceClaims: (guildId: string) =>
    call<{ claims: VoiceClaim[] }>(`/guilds/${guildId}/voice-claims`),
  createVoiceClaim: (guildId: string, body: CreateVoiceClaimInput) =>
    call<VoiceClaim>(`/guilds/${guildId}/voice-claims`, { method: 'POST', body }),
  deleteVoiceClaim: (guildId: string, channelId: string) =>
    call<void>(`/guilds/${guildId}/voice-claims/${channelId}`, { method: 'DELETE' }),
  updateVoiceClaim: (guildId: string, channelId: string, body: UpdateVoiceClaimInput) =>
    call<VoiceClaim>(`/guilds/${guildId}/voice-claims/${channelId}`, {
      method: 'PATCH',
      body,
    }),

  // Soundboard clips
  listClips: (guildId: string) =>
    call<{ clips: SoundboardClip[] }>(`/guilds/${guildId}/soundboard`),
  getClip: (guildId: string, name: string) =>
    call<SoundboardClip>(`/guilds/${guildId}/soundboard/${encodeURIComponent(name)}`),
  createClip: (guildId: string, body: UpsertSoundboardClipInput) =>
    call<SoundboardClip>(`/guilds/${guildId}/soundboard`, { method: 'POST', body }),
  deleteClip: (guildId: string, name: string) =>
    call<void>(`/guilds/${guildId}/soundboard/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  // TTS announcements
  getTtsConfig: (guildId: string) => call<TtsConfig>(`/guilds/${guildId}/tts-config`),
  upsertTtsConfig: (guildId: string, body: UpsertTtsConfigInput) =>
    call<TtsConfig>(`/guilds/${guildId}/tts-config`, { method: 'PUT', body }),

  // Insights — bot-side bulk increment + (admin-only on the API side) summary
  getInsights: (guildId: string, days = 30) =>
    call<InsightsSummary>(`/guilds/${guildId}/insights`, { query: { days } }),
  postActivityBatch: (guildId: string, body: ActivityEventsBatchInput) =>
    call<{ ok: boolean }>(`/guilds/${guildId}/activity-events`, {
      method: 'POST',
      body,
    }),
  // Activity-role rules
  listActivityRules: (guildId: string) =>
    call<{ rules: ActivityRoleRule[] }>(`/guilds/${guildId}/activity-rules`),
  createActivityRule: (guildId: string, body: UpsertActivityRoleRuleInput) =>
    call<ActivityRoleRule>(`/guilds/${guildId}/activity-rules`, {
      method: 'POST',
      body,
    }),
  updateActivityRule: (
    guildId: string,
    ruleId: string,
    body: Partial<UpsertActivityRoleRuleInput>,
  ) =>
    call<ActivityRoleRule>(`/guilds/${guildId}/activity-rules/${ruleId}`, {
      method: 'PATCH',
      body,
    }),
  deleteActivityRule: (guildId: string, ruleId: string) =>
    call<void>(`/guilds/${guildId}/activity-rules/${ruleId}`, { method: 'DELETE' }),

  // Inactivity prune policy
  getPrunePolicy: (guildId: string) =>
    call<InactivityPrunePolicy>(`/guilds/${guildId}/prune-policy`),
  upsertPrunePolicy: (guildId: string, body: UpsertPolicyInput) =>
    call<InactivityPrunePolicy>(`/guilds/${guildId}/prune-policy`, {
      method: 'PUT',
      body,
    }),

  // Prune preview/execute (dashboard-facing; bot computes locally for
  // slash commands but these are wired up so the dashboard can drive them).
  prunePreview: (guildId: string) =>
    call<{ policy: InactivityPrunePolicy; candidates: PruneCandidate[] }>(
      `/guilds/${guildId}/prune/preview`,
      { method: 'POST' },
    ),
  pruneExecute: (guildId: string) =>
    call<{ policy: InactivityPrunePolicy; candidates: PruneCandidate[] }>(
      `/guilds/${guildId}/prune/execute`,
      { method: 'POST' },
    ),

  // Member activity (bot-bearer)
  postMemberActivityBatch: (guildId: string, entries: MemberActivityBatchEntry[]) =>
    call<{ ok: boolean; count: number }>(`/guilds/${guildId}/member-activity/batch`, {
      method: 'POST',
      body: { entries },
    }),
  listMemberActivity: (guildId: string, query?: { sinceDays?: number; limit?: number }) =>
    call<{ members: MemberActivity[] }>(`/guilds/${guildId}/member-activity`, {
      query: {
        ...(query?.sinceDays !== undefined ? { sinceDays: query.sinceDays } : {}),
        ...(query?.limit !== undefined ? { limit: query.limit } : {}),
      },
    }),
  getMemberActivity: (guildId: string, userId: string) =>
    call<{
      guildId: string;
      userId: string;
      messages: number;
      voiceMinutes: number;
      lastActiveAt: string | null;
    }>(`/guilds/${guildId}/member-activity/${userId}`),

  // ─── Minigames: trivia ───────────────────────────────────────────
  listTriviaQuestions: (guildId: string, query?: { category?: string; limit?: number }) =>
    call<{ questions: TriviaQuestion[] }>(`/guilds/${guildId}/trivia`, query ? { query } : {}),
  addTriviaQuestion: (guildId: string, body: CreateTriviaQuestionInput) =>
    call<TriviaQuestion>(`/guilds/${guildId}/trivia`, { method: 'POST', body }),
  deleteTriviaQuestion: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/trivia/${id}`, { method: 'DELETE' }),
  randomTriviaQuestion: (guildId: string, query?: { category?: string }) =>
    call<TriviaQuestion>(
      `/guilds/${guildId}/trivia/random`,
      query?.category ? { query: { category: query.category } } : {},
    ),
  listTriviaScores: (guildId: string, limit = 10) =>
    call<{ scores: TriviaScore[] }>(`/guilds/${guildId}/trivia-scores`, { query: { limit } }),
  incrementTriviaScore: (guildId: string, body: { userId: string; correct: boolean }) =>
    call<TriviaScore>(`/guilds/${guildId}/trivia-score/increment`, { method: 'POST', body }),

  // ─── Minigames: hangman ─────────────────────────────────────────
  createHangmanGame: (guildId: string, body: CreateHangmanGameInput) =>
    call<HangmanGame>(`/guilds/${guildId}/hangman`, { method: 'POST', body }),
  getHangmanGame: (id: string) => call<HangmanGame>(`/hangman/${id}`),
  updateHangmanGame: (id: string, body: UpdateHangmanGameInput) =>
    call<HangmanGame>(`/hangman/${id}`, { method: 'PATCH', body }),

  // ─── Minigames: RPS ─────────────────────────────────────────────
  getRpsRecord: (guildId: string, userId: string) =>
    call<RpsRecord>(`/guilds/${guildId}/rps-record/${userId}`),
  postRpsChallenge: (guildId: string, body: CreateRpsChallengeInput) =>
    call<RpsChallenge>(`/guilds/${guildId}/rps-challenges`, { method: 'POST', body }),
  respondRpsChallenge: (challengeId: string, body: RespondRpsChallengeInput) =>
    call<ResolveRpsChallengeResult>(`/rps-challenges/${challengeId}/respond`, {
      method: 'POST',
      body,
    }),

  // ─── Minigames: daily streak ────────────────────────────────────
  claimDailyStreak: (guildId: string, userId: string) =>
    call<ClaimDailyResult>(`/guilds/${guildId}/daily/claim`, {
      method: 'POST',
      body: { userId },
    }),

  // Backup & restore — config snapshots
  listSnapshots: (guildId: string) =>
    call<{ snapshots: ConfigSnapshot[] }>(`/guilds/${guildId}/snapshots`),
  getSnapshot: (guildId: string, snapshotId: string) =>
    call<ConfigSnapshotDetail>(`/guilds/${guildId}/snapshots/${snapshotId}`),
  createSnapshot: (guildId: string, body: CreateSnapshotInput) =>
    call<ConfigSnapshot>(`/guilds/${guildId}/snapshots`, { method: 'POST', body }),
  restoreSnapshot: (guildId: string, snapshotId: string) =>
    call<{ restored: boolean; snapshotId: string; tables: Record<string, number> }>(
      `/guilds/${guildId}/snapshots/${snapshotId}/restore`,
      { method: 'POST' },
    ),
  deleteSnapshot: (guildId: string, snapshotId: string) =>
    call<void>(`/guilds/${guildId}/snapshots/${snapshotId}`, { method: 'DELETE' }),
  getSnapshotPolicy: (guildId: string) =>
    call<SnapshotPolicy>(`/guilds/${guildId}/snapshot-policy`),
  upsertSnapshotPolicy: (guildId: string, body: UpsertSnapshotPolicyInput) =>
    call<SnapshotPolicy>(`/guilds/${guildId}/snapshot-policy`, { method: 'PUT', body }),
  listAutoSnapshotPolicies: () =>
    call<{ policies: SnapshotPolicy[] }>(`/snapshot-policies/auto-enabled`),
  pruneSnapshots: (guildId: string, retentionDays: number) =>
    call<{ pruned: number }>(`/guilds/${guildId}/snapshots/prune`, {
      method: 'POST',
      body: { retentionDays },
    }),
  // Warning ladder
  listLadder: (guildId: string) =>
    call<{ steps: WarningLadderStep[] }>(`/guilds/${guildId}/warn-ladder`),
  upsertLadderStep: (guildId: string, body: UpsertLadderStepInput) =>
    call<WarningLadderStep>(`/guilds/${guildId}/warn-ladder`, { method: 'POST', body }),
  deleteLadderStep: (guildId: string, stepId: string) =>
    call<void>(`/guilds/${guildId}/warn-ladder/${stepId}`, { method: 'DELETE' }),
  deleteLadderStepByThreshold: (guildId: string, threshold: number) =>
    call<void>(`/guilds/${guildId}/warn-ladder/by-threshold/${threshold}`, { method: 'DELETE' }),
  getTriggeredLadderStep: (guildId: string, activeWarnings: number) =>
    call<{ step: WarningLadderStep | null }>(`/guilds/${guildId}/warn-ladder/triggered`, {
      query: { activeWarnings },
    }),

  // Appeals
  listAppeals: (
    guildId: string,
    query?: { status?: AppealStatus; userId?: string; limit?: number },
  ) => call<{ appeals: Appeal[] }>(`/guilds/${guildId}/appeals`, query ? { query } : {}),
  getAppeal: (guildId: string, appealId: string) =>
    call<Appeal>(`/guilds/${guildId}/appeals/${appealId}`),
  createAppeal: (guildId: string, body: CreateAppealInput) =>
    call<Appeal>(`/guilds/${guildId}/appeals`, { method: 'POST', body }),
  reviewAppeal: (guildId: string, appealId: string, body: ReviewAppealInput) =>
    call<Appeal>(`/guilds/${guildId}/appeals/${appealId}/review`, {
      method: 'POST',
      body,
    }),
  getAppealSla: (guildId: string) => call<AppealSlaConfig>(`/guilds/${guildId}/appeal-sla`),
  upsertAppealSla: (guildId: string, body: UpsertAppealSlaConfigInput) =>
    call<AppealSlaConfig>(`/guilds/${guildId}/appeal-sla`, { method: 'PUT', body }),
  staleAppeals: (limit = 50) =>
    call<{ appeals: Array<Appeal & { escalateChannelId: string }> }>(`/appeals/stale`, {
      query: { limit },
    }),
  // Outbound webhooks
  listOutboundWebhooks: (guildId: string) =>
    call<{ webhooks: OutboundWebhook[] }>(`/guilds/${guildId}/webhooks`),
  createOutboundWebhook: (guildId: string, body: CreateOutboundWebhookInput) =>
    call<OutboundWebhook & { secret: string }>(`/guilds/${guildId}/webhooks`, {
      method: 'POST',
      body,
    }),
  updateOutboundWebhook: (guildId: string, id: string, body: UpdateOutboundWebhookInput) =>
    call<OutboundWebhook>(`/guilds/${guildId}/webhooks/${id}`, { method: 'PATCH', body }),
  deleteOutboundWebhook: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/webhooks/${id}`, { method: 'DELETE' }),
  listWebhookDeliveries: (guildId: string, id: string, limit = 25) =>
    call<{ deliveries: WebhookDelivery[] }>(`/guilds/${guildId}/webhooks/${id}/deliveries`, {
      query: { limit },
    }),
  testOutboundWebhook: (guildId: string, id: string) =>
    call<{ enqueued: boolean; deliveryId: string }>(`/guilds/${guildId}/webhooks/${id}/test`, {
      method: 'POST',
    }),

  // Public API tokens
  listApiTokens: (guildId: string) =>
    call<{ tokens: PublicApiToken[] }>(`/guilds/${guildId}/api-tokens`),
  createApiToken: (guildId: string, body: CreatePublicApiTokenInput) =>
    call<PublicApiToken & { token: string }>(`/guilds/${guildId}/api-tokens`, {
      method: 'POST',
      body,
    }),
  revokeApiToken: (guildId: string, tokenId: string) =>
    call<void>(`/guilds/${guildId}/api-tokens/${tokenId}`, { method: 'DELETE' }),
  // Observability — bot → API heartbeat + counter bumps.
  postHeartbeat: () => call<{ ok: true }>(`/bot/heartbeat`, { method: 'POST', body: {} }),
  postMetric: (name: string, labels?: Record<string, string | number>, by?: number) =>
    call<{ ok: boolean }>(`/bot/metric`, {
      method: 'POST',
      body: {
        name,
        ...(labels ? { labels } : {}),
        ...(by !== undefined ? { by } : {}),
      },
    }),
  // Music queue
  getQueue: (guildId: string) => call<MusicQueue>(`/guilds/${guildId}/music`),
  setQueueState: (guildId: string, body: SetQueueStateInput) =>
    call<MusicQueue>(`/guilds/${guildId}/music`, { method: 'PATCH', body }),
  setLoopMode: (guildId: string, loopMode: LoopMode) =>
    call<MusicQueue>(`/guilds/${guildId}/music`, { method: 'PATCH', body: { loopMode } }),
  addTrack: (guildId: string, body: AddTrackInput) =>
    call<MusicTrack>(`/guilds/${guildId}/music/tracks`, { method: 'POST', body }),
  removeTrack: (guildId: string, trackId: string) =>
    call<void>(`/guilds/${guildId}/music/tracks/${trackId}`, { method: 'DELETE' }),
  moveTrack: (guildId: string, body: MoveTrackInput) =>
    call<{ tracks: MusicTrack[] }>(`/guilds/${guildId}/music/tracks/move`, {
      method: 'POST',
      body,
    }),
  clearQueue: (guildId: string) =>
    call<MusicQueue>(`/guilds/${guildId}/music/tracks`, { method: 'DELETE' }),
  // Giveaways
  listGiveaways: (guildId: string, query?: { status?: GiveawayStatus; limit?: number }) =>
    call<{ giveaways: Giveaway[] }>(`/guilds/${guildId}/giveaways`, query ? { query } : {}),
  getGiveaway: (guildId: string, giveawayId: string) =>
    call<Giveaway>(`/guilds/${guildId}/giveaways/${giveawayId}`),
  createGiveaway: (guildId: string, body: CreateGiveawayInput) =>
    call<Giveaway>(`/guilds/${guildId}/giveaways`, { method: 'POST', body }),
  setGiveawayMessageId: (guildId: string, giveawayId: string, messageId: string | null) =>
    call<Giveaway>(`/guilds/${guildId}/giveaways/${giveawayId}/messageId`, {
      method: 'POST',
      body: { messageId },
    }),
  enterGiveaway: (guildId: string, giveawayId: string, body: EnterGiveawayInput) =>
    call<Giveaway>(`/guilds/${guildId}/giveaways/${giveawayId}/enter`, {
      method: 'POST',
      body,
    }),
  endGiveaway: (guildId: string, giveawayId: string) =>
    call<Giveaway>(`/guilds/${guildId}/giveaways/${giveawayId}/end`, { method: 'POST' }),
  rerollGiveaway: (guildId: string, giveawayId: string) =>
    call<Giveaway>(`/guilds/${guildId}/giveaways/${giveawayId}/reroll`, { method: 'POST' }),
  cancelGiveaway: (guildId: string, giveawayId: string) =>
    call<Giveaway>(`/guilds/${guildId}/giveaways/${giveawayId}/cancel`, { method: 'POST' }),
  dueGiveaways: (limit = 50) =>
    call<{ giveaways: Giveaway[] }>(`/giveaways/due`, { query: { limit } }),
  // Starboard
  getStarboardConfig: (guildId: string) =>
    call<StarboardConfig>(`/guilds/${guildId}/starboard-config`),
  upsertStarboardConfig: (guildId: string, body: UpsertStarboardConfigInput) =>
    call<StarboardConfig>(`/guilds/${guildId}/starboard-config`, { method: 'PUT', body }),
  listStarboardEntries: (guildId: string, query?: { top?: number; days?: number }) =>
    call<{ entries: StarboardEntry[] }>(
      `/guilds/${guildId}/starboard-entries`,
      query
        ? {
            query: {
              ...(query.top !== undefined ? { top: query.top } : {}),
              ...(query.days !== undefined ? { days: query.days } : {}),
            },
          }
        : {},
    ),

  // Reports / mod queue
  listReports: (guildId: string, query?: { status?: ReportStatus; limit?: number }) =>
    call<{ reports: Report[] }>(
      `/guilds/${guildId}/reports`,
      query
        ? {
            query: {
              ...(query.status ? { status: query.status } : {}),
              ...(query.limit !== undefined ? { limit: query.limit } : {}),
            },
          }
        : {},
    ),
  recordStar: (guildId: string, body: RecordStarInput) =>
    call<StarboardEntry>(`/guilds/${guildId}/starboard-entries`, { method: 'POST', body }),
  setStarboardMessageId: (
    guildId: string,
    sourceMessageId: string,
    body: { starboardMessageId: string | null },
  ) =>
    call<StarboardEntry>(`/guilds/${guildId}/starboard-entries/${sourceMessageId}`, {
      method: 'PATCH',
      body,
    }),
  // Counter channels
  listCounterChannels: (guildId: string) =>
    call<{ counters: CounterChannel[] }>(`/guilds/${guildId}/counter-channels`),
  upsertCounterChannel: (guildId: string, body: UpsertCounterChannelInput) =>
    call<CounterChannel>(`/guilds/${guildId}/counter-channels`, { method: 'PUT', body }),
  deleteCounterChannel: (guildId: string, channelId: string) =>
    call<void>(`/guilds/${guildId}/counter-channels/${channelId}`, { method: 'DELETE' }),

  // Vanity roles
  listVanityRoles: (guildId: string, kind?: VanityRoleKind) =>
    call<{ vanityRoles: VanityRole[] }>(
      `/guilds/${guildId}/vanity-roles`,
      kind ? { query: { kind } } : {},
    ),
  createVanityRole: (guildId: string, body: UpsertVanityRoleInput) =>
    call<VanityRole>(`/guilds/${guildId}/vanity-roles`, { method: 'POST', body }),
  deleteVanityRole: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/vanity-roles/${id}`, { method: 'DELETE' }),
  deleteVanityRoleByRoleId: (guildId: string, roleId: string) =>
    call<void>(`/guilds/${guildId}/vanity-roles/by-role/${roleId}`, { method: 'DELETE' }),
  // Public-feed subscriptions (YouTube / Reddit / Bluesky / Mastodon)
  listFeeds: (guildId: string, query?: { kind?: FeedKind }) =>
    call<{ feeds: FeedSubscription[] }>(
      `/guilds/${guildId}/feeds`,
      query?.kind ? { query: { kind: query.kind } } : {},
    ),
  createFeed: (guildId: string, body: CreateFeedSubscriptionInput) =>
    call<FeedSubscription>(`/guilds/${guildId}/feeds`, { method: 'POST', body }),
  deleteFeed: (guildId: string, feedId: string) =>
    call<void>(`/guilds/${guildId}/feeds/${feedId}`, { method: 'DELETE' }),
  updateFeedLastItem: (guildId: string, feedId: string, lastItemId: string | null) =>
    call<FeedSubscription>(`/guilds/${guildId}/feeds/${feedId}/lastItem`, {
      method: 'PATCH',
      body: { lastItemId },
    }),
  enabledFeeds: (query?: { kind?: FeedKind; limit?: number }) =>
    call<{ feeds: FeedSubscription[] }>(`/feeds/enabled`, {
      query: {
        ...(query?.kind ? { kind: query.kind } : {}),
        ...(query?.limit !== undefined ? { limit: query.limit } : {}),
      },
    }),
  // Forum auto-tag rules
  listForumTags: (guildId: string) =>
    call<{ tags: ForumAutoTag[] }>(`/guilds/${guildId}/forum-tags`),
  createForumTag: (guildId: string, body: UpsertForumAutoTagInput) =>
    call<ForumAutoTag>(`/guilds/${guildId}/forum-tags`, { method: 'POST', body }),
  deleteForumTag: (guildId: string, tagId: string) =>
    call<void>(`/guilds/${guildId}/forum-tags/${tagId}`, { method: 'DELETE' }),

  // Stale thread policy
  getStaleThreadPolicy: (guildId: string) =>
    call<StaleThreadPolicy>(`/guilds/${guildId}/stale-thread-policy`),
  upsertStaleThreadPolicy: (guildId: string, body: UpsertStalePolicyInput) =>
    call<StaleThreadPolicy>(`/guilds/${guildId}/stale-thread-policy`, { method: 'PUT', body }),

  // Stage scheduled events
  listStageEvents: (guildId: string, query?: { status?: StageEventStatus; limit?: number }) =>
    call<{ events: StageScheduledEvent[] }>(
      `/guilds/${guildId}/stage-events`,
      query ? { query } : {},
    ),
  createStageEvent: (guildId: string, body: CreateStageEventInput) =>
    call<StageScheduledEvent>(`/guilds/${guildId}/stage-events`, { method: 'POST', body }),
  getStageEvent: (guildId: string, eventId: string) =>
    call<StageScheduledEvent>(`/guilds/${guildId}/stage-events/${eventId}`),
  updateStageEventStatus: (guildId: string, eventId: string, status: StageEventStatus) =>
    call<StageScheduledEvent>(`/guilds/${guildId}/stage-events/${eventId}`, {
      method: 'PATCH',
      body: { status },
    }),
  deleteStageEvent: (guildId: string, eventId: string) =>
    call<void>(`/guilds/${guildId}/stage-events/${eventId}`, { method: 'DELETE' }),
  // Anti-raid / captcha
  getAntiRaidConfig: (guildId: string) =>
    call<AntiRaidConfig>(`/guilds/${guildId}/anti-raid-config`),
  upsertAntiRaidConfig: (guildId: string, body: UpsertAntiRaidConfigInput) =>
    call<AntiRaidConfig>(`/guilds/${guildId}/anti-raid-config`, { method: 'PUT', body }),
  listLockdownEvents: (guildId: string, limit = 50) =>
    call<{ events: LockdownEvent[] }>(`/guilds/${guildId}/lockdown-events`, {
      query: { limit },
    }),
  startLockdown: (guildId: string, trigger: string) =>
    call<LockdownEvent>(`/guilds/${guildId}/lockdown/start`, {
      method: 'POST',
      body: { trigger },
    }),
  endLockdown: (guildId: string, id: string, joinsBlocked?: number) =>
    call<LockdownEvent>(`/guilds/${guildId}/lockdown/${id}/end`, {
      method: 'POST',
      body: joinsBlocked !== undefined ? { joinsBlocked } : {},
    }),
  createPendingVerification: (guildId: string, body: CreatePendingVerificationInput) =>
    call<PendingVerification>(`/guilds/${guildId}/pending-verifications`, {
      method: 'POST',
      body,
    }),
  getPendingVerification: (guildId: string, userId: string) =>
    call<PendingVerification>(`/guilds/${guildId}/pending-verifications/${userId}`),
  deletePendingVerification: (guildId: string, userId: string) =>
    call<void>(`/guilds/${guildId}/pending-verifications/${userId}`, { method: 'DELETE' }),
  expiredPendingVerifications: () =>
    call<{ pending: PendingVerification[] }>(`/pending-verifications/expired`),
  verifyChallenge: (guildId: string, userId: string, body: VerifyChallengeInput) =>
    call<VerifyChallengeResult>(`/guilds/${guildId}/pending-verifications/${userId}/verify`, {
      method: 'POST',
      body,
    }),

  getReport: (guildId: string, reportId: string) =>
    call<Report>(`/guilds/${guildId}/reports/${reportId}`),
  createReport: (guildId: string, body: CreateReportInput) =>
    call<Report>(`/guilds/${guildId}/reports`, { method: 'POST', body }),
  reviewReport: (
    guildId: string,
    reportId: string,
    body: { action: ReportAction; note?: string; reviewerId: string },
  ) =>
    call<Report>(`/guilds/${guildId}/reports/${reportId}/review`, {
      method: 'POST',
      body,
    }),
  // Server templates
  listTemplates: (guildId: string) =>
    call<{ templates: ServerTemplate[] }>(`/guilds/${guildId}/templates`),
  listPublicTemplates: (limit = 50) =>
    call<{ templates: ServerTemplate[] }>(`/templates/public`, { query: { limit } }),
  getTemplate: (id: string, guildId?: string) =>
    call<ServerTemplate>(`/templates/${id}`, guildId ? { query: { guildId } } : {}),
  captureTemplate: (guildId: string, body: CreateTemplateInput) =>
    call<ServerTemplate>(`/guilds/${guildId}/templates/capture`, {
      method: 'POST',
      body,
    }),
  shareTemplate: (id: string) => call<ServerTemplate>(`/templates/${id}/share`, { method: 'POST' }),
  diffTemplate: (id: string, targetGuildId: string, body: TemplatePayload) =>
    call<TemplateDiff>(`/templates/${id}/diff`, {
      method: 'POST',
      body,
      query: { targetGuildId },
    }),
  deleteTemplate: (id: string) => call<void>(`/templates/${id}`, { method: 'DELETE' }),
  // ─── Privacy / GDPR ────────────────────────────────────────────────
  requestDataExport: (body: { userId: string; guildId?: string }) =>
    call<{
      jobId: string;
      status: 'completed';
      payload: Record<string, unknown>;
    }>(`/me/data-export`, { method: 'POST', body }),
  requestDataDelete: (body: { userId: string; guildId?: string }) =>
    call<{
      id: string;
      token: string;
      requestedAt: string;
      guildId: string | null;
    }>(`/me/data-delete`, { method: 'POST', body }),
  confirmDataDelete: (body: { token: string; userId: string }) =>
    call<{
      id: string;
      status: 'completed';
      deleted: Record<string, number>;
    }>(`/me/data-delete/confirm`, { method: 'POST', body }),

  // Retention policy (bot-side)
  getRetentionPolicy: (guildId: string) =>
    call<RetentionPolicy>(`/guilds/${guildId}/retention-policy`),
  upsertRetentionPolicy: (guildId: string, body: UpsertRetentionPolicyInput) =>
    call<RetentionPolicy>(`/guilds/${guildId}/retention-policy`, {
      method: 'PUT',
      body,
    }),
  listRetentionPolicyGuilds: () => call<{ guildIds: string[] }>(`/retention-policies`),
  pruneRetention: (guildId: string) =>
    call<{
      guildId: string;
      modActions: number;
      modNotes: number;
      tickets: number;
      messageActivity: number;
      auditEvents: number;
    }>(`/guilds/${guildId}/retention-prune`, { method: 'POST' }),

  // ─── Invite tracker ────────────────────────────────────────────────
  listInvites: (guildId: string) =>
    call<{ invites: InviteCode[] }>(`/guilds/${guildId}/invites`),
  upsertInvite: (guildId: string, body: UpsertInviteCodeInput) =>
    call<InviteCode>(`/guilds/${guildId}/invites`, { method: 'POST', body }),
  deleteInvite: (guildId: string, code: string) =>
    call<void>(`/guilds/${guildId}/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  inviteLeaderboard: (guildId: string, limit = 25) =>
    call<{ entries: InviterLeaderboardEntry[] }>(`/guilds/${guildId}/invites/leaderboard`, {
      query: { limit },
    }),
  inviteStatsForUser: (guildId: string, userId: string) =>
    call<InviterLeaderboardEntry>(`/guilds/${guildId}/invites/by-user/${userId}`),
  recordMemberInvite: (guildId: string, body: CreateMemberInviteInput) =>
    call<MemberInvite>(`/guilds/${guildId}/member-invites`, { method: 'POST', body }),
  updateMemberInvite: (guildId: string, userId: string, body: UpdateMemberInviteInput) =>
    call<MemberInvite>(`/guilds/${guildId}/member-invites/${userId}`, { method: 'PATCH', body }),
  listInviteGatedRoles: (guildId: string) =>
    call<{ rules: InviteGatedRole[] }>(`/guilds/${guildId}/invite-gated-roles`),
  upsertInviteGatedRole: (guildId: string, body: UpsertInviteGatedRoleInput) =>
    call<InviteGatedRole>(`/guilds/${guildId}/invite-gated-roles`, { method: 'POST', body }),
  deleteInviteGatedRole: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/invite-gated-roles/${id}`, { method: 'DELETE' }),
  // ─── Member milestones ────────────────────────────────────────────────
  getMilestoneConfig: (guildId: string) =>
    call<MilestoneConfig>(`/guilds/${guildId}/milestone-config`),
  upsertMilestoneConfig: (guildId: string, body: UpsertMilestoneConfigInput) =>
    call<MilestoneConfig>(`/guilds/${guildId}/milestone-config`, { method: 'PUT', body }),

  listTenureRoles: (guildId: string) =>
    call<{ rules: TenureRoleRule[] }>(`/guilds/${guildId}/tenure-roles`),
  createTenureRole: (guildId: string, body: UpsertTenureRoleRuleInput) =>
    call<TenureRoleRule>(`/guilds/${guildId}/tenure-roles`, { method: 'POST', body }),
  updateTenureRole: (
    guildId: string,
    ruleId: string,
    body: Partial<UpsertTenureRoleRuleInput>,
  ) =>
    call<TenureRoleRule>(`/guilds/${guildId}/tenure-roles/${ruleId}`, {
      method: 'PATCH',
      body,
    }),
  deleteTenureRole: (guildId: string, ruleId: string) =>
    call<void>(`/guilds/${guildId}/tenure-roles/${ruleId}`, { method: 'DELETE' }),
  deleteTenureRoleByRoleId: (guildId: string, roleId: string) =>
    call<void>(`/guilds/${guildId}/tenure-roles/by-role/${roleId}`, { method: 'DELETE' }),

  listEnabledMilestoneConfigs: () =>
    call<{ configs: MilestoneConfig[] }>(`/milestone-configs/enabled`),
  recordMilestoneAward: (guildId: string, body: CreateMilestoneAwardInput) =>
    call<MilestoneAward>(`/guilds/${guildId}/milestone-awards`, {
      method: 'POST',
      body,
    }),
  listMilestoneAwards: (
    guildId: string,
    query?: { userId?: string; kind?: MilestoneAwardKind; limit?: number },
  ) =>
    call<{ awards: MilestoneAward[] }>(`/guilds/${guildId}/milestone-awards`, {
      query: {
        ...(query?.userId ? { userId: query.userId } : {}),
        ...(query?.kind ? { kind: query.kind } : {}),
        ...(query?.limit !== undefined ? { limit: query.limit } : {}),
      },
    }),
  // ─── Onboarding forms + applications ─────────────────────────────────
  listForms: (guildId: string) =>
    call<{ forms: OnboardingForm[] }>(`/guilds/${guildId}/onboarding-forms`),
  getForm: (guildId: string, slug: string) =>
    call<OnboardingForm>(`/guilds/${guildId}/onboarding-forms/${encodeURIComponent(slug)}`),
  createForm: (guildId: string, body: UpsertOnboardingFormInput) =>
    call<OnboardingForm>(`/guilds/${guildId}/onboarding-forms`, { method: 'POST', body }),
  updateForm: (guildId: string, formId: string, body: UpsertOnboardingFormInput) =>
    call<OnboardingForm>(`/guilds/${guildId}/onboarding-forms/${formId}`, {
      method: 'PATCH',
      body,
    }),
  deleteForm: (guildId: string, formId: string) =>
    call<void>(`/guilds/${guildId}/onboarding-forms/${formId}`, { method: 'DELETE' }),
  listApplications: (
    guildId: string,
    query?: { status?: ApplicationStatus; formId?: string; limit?: number },
  ) =>
    call<{ applications: Application[] }>(
      `/guilds/${guildId}/applications`,
      query
        ? {
            query: {
              ...(query.status ? { status: query.status } : {}),
              ...(query.formId ? { formId: query.formId } : {}),
              ...(query.limit !== undefined ? { limit: query.limit } : {}),
            },
          }
        : {},
    ),
  getApplication: (guildId: string, applicationId: string) =>
    call<Application>(`/guilds/${guildId}/applications/${applicationId}`),
  createApplication: (guildId: string, body: CreateApplicationInput) =>
    call<Application>(`/guilds/${guildId}/applications`, { method: 'POST', body }),
  updateApplication: (
    guildId: string,
    applicationId: string,
    body: ReviewApplicationInput,
  ) =>
    call<Application>(`/guilds/${guildId}/applications/${applicationId}`, {
      method: 'PATCH',
      body,
    }),
  // ─── Link safety ──────────────────────────────────────────────────
  getLinkSafetyConfig: (guildId: string) =>
    call<LinkSafetyConfig>(`/guilds/${guildId}/link-safety-config`),
  // Lightweight probe used by the hot-path scanner; the API returns the same
  // payload as `getLinkSafetyConfig` but is intended to be cached aggressively.
  getEnabledLinkSafetyConfig: (guildId: string) =>
    call<LinkSafetyConfig>(`/guilds/${guildId}/link-safety-config/enabled`),
  upsertLinkSafetyConfig: (guildId: string, body: UpsertLinkSafetyConfigInput) =>
    call<LinkSafetyConfig>(`/guilds/${guildId}/link-safety-config`, {
      method: 'PUT',
      body,
    }),
  listLinkDomains: (guildId: string, kind?: LinkDomainKind) =>
    call<{ domains: LinkDomain[] }>(
      `/guilds/${guildId}/link-domains`,
      kind ? { query: { kind } } : {},
    ),
  createLinkDomain: (guildId: string, body: CreateLinkDomainInput) =>
    call<LinkDomain>(`/guilds/${guildId}/link-domains`, { method: 'POST', body }),
  deleteLinkDomain: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/link-domains/${id}`, { method: 'DELETE' }),
  // Economy expansion (v0.49) — extended shop items, inventory, mini-games,
  // and loot crates. Lives alongside the legacy /shop endpoints; the legacy
  // ones stay in place so older bot deployments don't break mid-rollout.
  listShopItems: (guildId: string, opts?: { includeDisabled?: boolean }) =>
    call<{ items: ShopItemExt[] }>(`/guilds/${guildId}/shop-items`, {
      query: opts?.includeDisabled ? { includeDisabled: 'true' } : {},
    }),
  createShopItemExt: (guildId: string, body: UpsertShopItemInput) =>
    call<ShopItemExt>(`/guilds/${guildId}/shop-items`, { method: 'POST', body }),
  updateShopItem: (
    guildId: string,
    id: string,
    body: Partial<UpsertShopItemInput>,
  ) =>
    call<ShopItemExt>(`/guilds/${guildId}/shop-items/${id}`, {
      method: 'PATCH',
      body,
    }),
  deleteShopItemExt: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/shop-items/${id}`, { method: 'DELETE' }),
  buyShopItemExt: (
    guildId: string,
    id: string,
    userId: string,
    quantity = 1,
  ) =>
    call<{
      item: ShopItemExt;
      balance: number;
      quantity: number;
      cost: number;
    }>(`/guilds/${guildId}/shop-items/${id}/buy`, {
      method: 'POST',
      body: { userId, quantity },
    }),

  listInventoryExt: (guildId: string, userId: string) =>
    call<{ entries: InventoryEntryExt[] }>(
      `/guilds/${guildId}/inventory/${userId}`,
    ),
  giftItem: (guildId: string, body: GiftRequest) =>
    call<{ from: InventoryEntryExt; to: InventoryEntryExt }>(
      `/guilds/${guildId}/inventory/transfer`,
      { method: 'POST', body },
    ),
  consumeItem: (guildId: string, body: ConsumeItemInput) =>
    call<ConsumeItemResult>(`/guilds/${guildId}/inventory/consume`, {
      method: 'POST',
      body,
    }),

  blackjackStart: (guildId: string, body: BetRequest) =>
    call<{ state: BlackjackState; balance: number | null }>(
      `/guilds/${guildId}/games/blackjack/start`,
      { method: 'POST', body },
    ),
  blackjackHit: (guildId: string, gameId: string) =>
    call<{ state: BlackjackState; balance: number | null }>(
      `/guilds/${guildId}/games/blackjack/${gameId}/hit`,
      { method: 'POST' },
    ),
  blackjackStand: (guildId: string, gameId: string) =>
    call<{ state: BlackjackState; balance: number | null }>(
      `/guilds/${guildId}/games/blackjack/${gameId}/stand`,
      { method: 'POST' },
    ),
  playSlots: (guildId: string, body: BetRequest) =>
    call<SlotsResult>(`/guilds/${guildId}/games/slots`, {
      method: 'POST',
      body,
    }),
  playDice: (guildId: string, body: DiceRequest) =>
    call<DiceResult>(`/guilds/${guildId}/games/dice`, {
      method: 'POST',
      body,
    }),

  listLootDrops: (guildId: string) =>
    call<{ drops: LootDrop[] }>(`/guilds/${guildId}/loot-drops`),
  createLootDrop: (guildId: string, body: UpsertLootDropInput) =>
    call<LootDrop>(`/guilds/${guildId}/loot-drops`, { method: 'POST', body }),
  updateLootDrop: (
    guildId: string,
    id: string,
    body: Partial<UpsertLootDropInput>,
  ) =>
    call<LootDrop>(`/guilds/${guildId}/loot-drops/${id}`, {
      method: 'PATCH',
      body,
    }),
  deleteLootDrop: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/loot-drops/${id}`, { method: 'DELETE' }),
  claimLoot: (guildId: string, userId: string) =>
    call<LootClaimResult>(`/guilds/${guildId}/loot-claims/claim`, {
      method: 'POST',
      body: { userId },
    }),

  // ─── Karaoke nights ────────────────────────────────────────────────────
  listKaraokeNights: (
    guildId: string,
    query?: { status?: KaraokeNightStatus; limit?: number },
  ) =>
    call<{ nights: KaraokeNight[] }>(`/guilds/${guildId}/karaoke-nights`, {
      query: {
        ...(query?.status ? { status: query.status } : {}),
        ...(query?.limit !== undefined ? { limit: query.limit } : {}),
      },
    }),
  getKaraokeNight: (guildId: string, id: string) =>
    call<KaraokeNight>(`/guilds/${guildId}/karaoke-nights/${id}`),
  createKaraokeNight: (guildId: string, body: CreateKaraokeNightInput) =>
    call<KaraokeNight>(`/guilds/${guildId}/karaoke-nights`, { method: 'POST', body }),
  updateKaraokeNight: (guildId: string, id: string, body: UpdateKaraokeNightInput) =>
    call<KaraokeNight>(`/guilds/${guildId}/karaoke-nights/${id}`, {
      method: 'PATCH',
      body,
    }),
  cancelKaraokeNight: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/karaoke-nights/${id}`, { method: 'DELETE' }),
  addKaraokeSong: (guildId: string, id: string, body: CreateKaraokeSongInput) =>
    call<KaraokeSong>(`/guilds/${guildId}/karaoke-nights/${id}/songs`, {
      method: 'POST',
      body,
    }),
  updateKaraokeSong: (
    guildId: string,
    id: string,
    songId: string,
    body: UpdateKaraokeSongInput,
  ) =>
    call<KaraokeSong>(`/guilds/${guildId}/karaoke-nights/${id}/songs/${songId}`, {
      method: 'PATCH',
      body,
    }),
  deleteKaraokeSong: (guildId: string, id: string, songId: string) =>
    call<void>(`/guilds/${guildId}/karaoke-nights/${id}/songs/${songId}`, {
      method: 'DELETE',
    }),
  rsvpKaraoke: (guildId: string, id: string, body: UpsertKaraokeRsvpInput) =>
    call<KaraokeNight>(`/guilds/${guildId}/karaoke-nights/${id}/rsvp`, {
      method: 'POST',
      body,
    }),
  dueKaraokeNights: () =>
    call<{
      t15: KaraokeNight[];
      starting: KaraokeNight[];
      endingLive: KaraokeNight[];
    }>(`/karaoke-nights/due`),
  // Server pet
  getServerPet: (guildId: string) => call<ServerPet>(`/guilds/${guildId}/server-pet`),
  renamePet: (guildId: string, body: UpsertPetNameInput) =>
    call<ServerPet>(`/guilds/${guildId}/server-pet`, { method: 'PATCH', body }),
  feedPet: (guildId: string, userId: string, currencySpent: number) =>
    call<PetActionResult>(`/guilds/${guildId}/server-pet/feed`, {
      method: 'POST',
      body: { userId, currencySpent },
    }),
  playWithPet: (guildId: string, userId: string) =>
    call<PetActionResult>(`/guilds/${guildId}/server-pet/play`, {
      method: 'POST',
      body: { userId },
    }),
  petPet: (guildId: string, userId: string) =>
    call<PetActionResult>(`/guilds/${guildId}/server-pet/pet`, {
      method: 'POST',
      body: { userId },
    }),
  topPetFeeder: (guildId: string, limit = 5) =>
    call<TopFeederResponse>(`/guilds/${guildId}/server-pet/top-feeder`, {
      query: { limit },
    }),
  tickServerPetDecay: () =>
    call<{ scanned: number; updated: number }>(`/server-pet/tick/decay`, { method: 'POST' }),
  // ─── Profile customization (v0.53) ───────────────────────────────────
  getUserProfile: (guildId: string, userId: string) =>
    call<UserProfile>(`/guilds/${guildId}/profile/${userId}`),
  upsertUserProfile: (guildId: string, userId: string, body: UpsertUserProfileInput) =>
    call<UserProfile>(`/guilds/${guildId}/profile/${userId}`, { method: 'PUT', body }),
  listProfileBadges: (guildId: string) =>
    call<{ badges: ProfileBadge[] }>(`/guilds/${guildId}/profile-badges`),
  createProfileBadge: (guildId: string, body: CreateProfileBadgeInput) =>
    call<ProfileBadge>(`/guilds/${guildId}/profile-badges`, { method: 'POST', body }),
  deleteProfileBadge: (guildId: string, slug: string) =>
    call<void>(`/guilds/${guildId}/profile-badges/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
    }),
  grantUserBadge: (guildId: string, slug: string, body: GrantUserBadgeInput) =>
    call<UserBadge>(`/guilds/${guildId}/profile-badges/${encodeURIComponent(slug)}/grant`, {
      method: 'POST',
      body,
    }),
  revokeUserBadge: (guildId: string, slug: string, userId: string) =>
    call<void>(
      `/guilds/${guildId}/profile-badges/${encodeURIComponent(slug)}/users/${userId}`,
      { method: 'DELETE' },
    ),

  // ─── Achievements (v0.54) ─────────────────────────────────────────────
  listAchievements: (
    guildId: string,
    opts?: { kind?: AchievementKind; enabled?: boolean },
  ) =>
    call<{ achievements: Achievement[] }>(`/guilds/${guildId}/achievements`, {
      query: {
        ...(opts?.kind ? { kind: opts.kind } : {}),
        ...(opts?.enabled !== undefined ? { enabled: String(opts.enabled) } : {}),
      },
    }),
  createAchievement: (guildId: string, body: CreateAchievementInput) =>
    call<Achievement>(`/guilds/${guildId}/achievements`, { method: 'POST', body }),
  updateAchievement: (
    guildId: string,
    achievementId: string,
    body: UpdateAchievementInput,
  ) =>
    call<Achievement>(`/guilds/${guildId}/achievements/${achievementId}`, {
      method: 'PATCH',
      body,
    }),
  deleteAchievement: (guildId: string, achievementId: string) =>
    call<void>(`/guilds/${guildId}/achievements/${achievementId}`, { method: 'DELETE' }),
  deleteAchievementBySlug: (guildId: string, slug: string) =>
    call<void>(`/guilds/${guildId}/achievements/by-slug/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
    }),
  listUserAchievements: (
    guildId: string,
    opts?: { userId?: string; limit?: number },
  ) =>
    call<{ userAchievements: UserAchievement[] }>(
      `/guilds/${guildId}/user-achievements`,
      {
        query: {
          ...(opts?.userId ? { userId: opts.userId } : {}),
          ...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
        },
      },
    ),
  awardUserAchievement: (guildId: string, body: AwardAchievementInput) =>
    call<AwardAchievementResult>(`/guilds/${guildId}/user-achievements/award`, {
      method: 'POST',
      body,
    }),
  seedAchievements: (guildId: string) =>
    call<{ inserted: number; skipped: number; achievements: Achievement[] }>(
      `/guilds/${guildId}/achievements/seed`,
      { method: 'POST' },
    ),
  // ─── Quests ─────────────────────────────────────────────────────────
  listQuestTemplates: (guildId: string) =>
    call<{ templates: QuestTemplate[] }>(`/guilds/${guildId}/quest-templates`),
  createQuestTemplate: (guildId: string, body: CreateQuestTemplateInput) =>
    call<QuestTemplate>(`/guilds/${guildId}/quest-templates`, { method: 'POST', body }),
  updateQuestTemplate: (guildId: string, slug: string, body: UpdateQuestTemplateInput) =>
    call<QuestTemplate>(`/guilds/${guildId}/quest-templates/${slug}`, {
      method: 'PATCH',
      body,
    }),
  deleteQuestTemplate: (guildId: string, slug: string) =>
    call<void>(`/guilds/${guildId}/quest-templates/${slug}`, { method: 'DELETE' }),
  seedQuestTemplates: (guildId: string) =>
    call<{ inserted: string[]; skipped: string[] }>(
      `/guilds/${guildId}/quest-templates/seed`,
      { method: 'POST' },
    ),
  getUserQuests: (guildId: string, userId: string) =>
    call<{ quests: UserQuest[] }>(`/guilds/${guildId}/user-quests/${userId}`),
  postQuestProgress: (guildId: string, body: ProgressEvent) =>
    call<{ updated: UserQuest[] }>(`/guilds/${guildId}/user-quests/progress`, {
      method: 'POST',
      body,
    }),
  claimUserQuest: (guildId: string, id: string) =>
    call<{
      quest: UserQuest;
      rewards: { currency: number; xp: number; roleId: string | null };
    }>(`/guilds/${guildId}/user-quests/${id}/claim`, { method: 'POST' }),
  expireUserQuests: () =>
    call<{ deleted: number }>(`/quests/expire`, { method: 'POST' }),
  // ─── Peer-to-peer marketplace (v0.56) ───────────────────────────────
  getMarketConfig: (guildId: string) =>
    call<MarketConfig>(`/guilds/${guildId}/marketplace-config`),
  upsertMarketConfig: (guildId: string, body: UpsertMarketConfigInput) =>
    call<MarketConfig>(`/guilds/${guildId}/marketplace-config`, {
      method: 'PUT',
      body,
    }),
  listListings: (
    guildId: string,
    query?: {
      status?: MarketListingStatus;
      sellerId?: string;
      itemSlug?: string;
      limit?: number;
    },
  ) =>
    call<{ listings: MarketListing[] }>(`/guilds/${guildId}/listings`, {
      query: {
        ...(query?.status ? { status: query.status } : {}),
        ...(query?.sellerId ? { sellerId: query.sellerId } : {}),
        ...(query?.itemSlug ? { itemSlug: query.itemSlug } : {}),
        ...(query?.limit !== undefined ? { limit: query.limit } : {}),
      },
    }),
  getListing: (guildId: string, id: string) =>
    call<MarketListing>(`/guilds/${guildId}/listings/${id}`),
  createListing: (guildId: string, body: CreateListingInput) =>
    call<MarketListing>(`/guilds/${guildId}/listings`, { method: 'POST', body }),
  buyListing: (guildId: string, id: string, buyerId: string) =>
    call<MarketListing>(`/guilds/${guildId}/listings/${id}/buy`, {
      method: 'POST',
      body: { buyerId },
    }),
  cancelListing: (guildId: string, id: string, requesterId: string) =>
    call<MarketListing>(`/guilds/${guildId}/listings/${id}/cancel`, {
      method: 'POST',
      body: { requesterId },
    }),
  sweepExpiredListings: () =>
    call<{ expired: MarketListing[] }>(`/marketplace/sweep-expired`, {
      method: 'POST',
    }),

  // Auctions (v0.57) — bid-based item sales on inventory items.
  listAuctions: (
    guildId: string,
    query?: { status?: AuctionStatus; limit?: number },
  ) =>
    call<{ auctions: Auction[] }>(
      `/guilds/${guildId}/auctions`,
      query ? { query } : {},
    ),
  getAuction: (guildId: string, auctionId: string) =>
    call<Auction>(`/guilds/${guildId}/auctions/${auctionId}`),
  createAuction: (guildId: string, body: CreateAuctionInput) =>
    call<Auction>(`/guilds/${guildId}/auctions`, { method: 'POST', body }),
  placeBid: (guildId: string, auctionId: string, body: PlaceBidInput) =>
    call<{ auction: Auction; bid: AuctionBid; extended: boolean }>(
      `/guilds/${guildId}/auctions/${auctionId}/bid`,
      { method: 'POST', body },
    ),
  cancelAuction: (guildId: string, auctionId: string, sellerId: string) =>
    call<Auction>(`/guilds/${guildId}/auctions/${auctionId}/cancel`, {
      method: 'POST',
      body: { sellerId },
    }),
  dueAuctions: (limit = 50) =>
    call<{ auctions: Auction[] }>(`/auctions/due`, {
      method: 'POST',
      body: { limit },
    }),
  settleAuction: (guildId: string, auctionId: string) =>
    call<Auction>(`/guilds/${guildId}/auctions/${auctionId}/settle`, {
      method: 'POST',
    }),

  // Fishing (v0.58)
  getFishingSkill: (guildId: string, userId: string) =>
    call<FishingSkill>(`/guilds/${guildId}/fishing/skill/${userId}`),
  listFishingDrops: (guildId: string) =>
    call<{ drops: FishingDrop[] }>(`/guilds/${guildId}/fishing/drops`),
  createFishingDrop: (guildId: string, body: CreateFishingDropInput) =>
    call<FishingDrop>(`/guilds/${guildId}/fishing/drops`, { method: 'POST', body }),
  deleteFishingDrop: (guildId: string, id: string) =>
    call<void>(`/guilds/${guildId}/fishing/drops/${id}`, { method: 'DELETE' }),
  seedFishingDrops: (guildId: string) =>
    call<{ inserted: number; total: number; drops: FishingDrop[] }>(
      `/guilds/${guildId}/fishing/drops/seed`,
      { method: 'POST' },
    ),
  castFishingLine: (guildId: string, userId: string) =>
    call<FishingCast>(`/guilds/${guildId}/fishing/cast`, {
      method: 'POST',
      body: { userId },
    }),
  resolveFishingCast: (guildId: string, castId: string) =>
    call<CastResult>(`/guilds/${guildId}/fishing/resolve`, {
      method: 'POST',
      body: { castId },
    }),
  resolveDueFishingCasts: (limit?: number) =>
    call<{ resolved: number }>(`/fishing/resolve-due`, {
      method: 'POST',
      body: limit !== undefined ? { limit } : undefined,
    }),
};
