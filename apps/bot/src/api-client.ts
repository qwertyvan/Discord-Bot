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
    call<{ id: string; name: string; iconUrl: string | null; addedAt: string }>(
      `/guilds/${id}`,
      { method: 'PUT', body },
    ),
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
  getWarningPolicy: (guildId: string) =>
    call<WarningPolicy>(`/guilds/${guildId}/warning-policy`),

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
  getLoggingConfig: (guildId: string) =>
    call<LoggingConfig>(`/guilds/${guildId}/logging-config`),

  // Welcome config
  getWelcomeConfig: (guildId: string) =>
    call<WelcomeConfig>(`/guilds/${guildId}/welcome`),
  updateWelcomeConfig: (guildId: string, body: UpdateWelcomeConfigInput) =>
    call<WelcomeConfig>(`/guilds/${guildId}/welcome`, { method: 'PUT', body }),

  // Automod
  getAutomodConfig: (guildId: string) =>
    call<AutomodConfig>(`/guilds/${guildId}/automod-config`),
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
  getPoll: (guildId: string, pollId: string) =>
    call<Poll>(`/guilds/${guildId}/polls/${pollId}`),
  updatePoll: (
    guildId: string,
    pollId: string,
    body: { messageId?: string | null; close?: boolean },
  ) => call<Poll>(`/guilds/${guildId}/polls/${pollId}`, { method: 'PATCH', body }),
  votePoll: (
    guildId: string,
    pollId: string,
    body: { userId: string; optionIds: string[] },
  ) => call<Poll>(`/guilds/${guildId}/polls/${pollId}/vote`, { method: 'POST', body }),
  duePolls: () => call<{ polls: Poll[] }>(`/polls/due`),

  // Reminders
  createReminder: (body: CreateReminderInput) =>
    call<Reminder>(`/reminders`, { method: 'POST', body }),
  listReminders: (userId: string) =>
    call<{ reminders: Reminder[] }>(`/users/${userId}/reminders`),
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

  // Leveling
  getLevelConfig: (guildId: string) =>
    call<LevelConfig>(`/guilds/${guildId}/level-config`),
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
  getEconomyConfig: (guildId: string) =>
    call<EconomyConfig>(`/guilds/${guildId}/economy-config`),
  getBalance: (guildId: string, userId: string) =>
    call<Balance>(`/guilds/${guildId}/balance/${userId}`),
  claimDaily: (guildId: string, userId: string) =>
    call<Balance & { reward: number }>(`/guilds/${guildId}/balance/${userId}/daily`, { method: 'POST' }),
  doWork: (guildId: string, userId: string) =>
    call<Balance & { reward: number }>(`/guilds/${guildId}/balance/${userId}/work`, { method: 'POST' }),
  transfer: (guildId: string, fromUserId: string, toUserId: string, amount: number) =>
    call<{ ok: boolean; amount: number }>(`/guilds/${guildId}/balance/${fromUserId}/transfer`, {
      method: 'POST',
      body: { toUserId, amount },
    }),
  adjustBalance: (guildId: string, userId: string, delta: number) =>
    call<Balance>(`/guilds/${guildId}/balance/${userId}/adjust`, { method: 'POST', body: { delta } }),
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
  listShop: (guildId: string) =>
    call<{ items: ShopItem[] }>(`/guilds/${guildId}/shop`),
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
  getTicketConfig: (guildId: string) =>
    call<TicketConfig>(`/guilds/${guildId}/ticket-config`),
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
  ) =>
    call<{ tickets: Ticket[] }>(`/guilds/${guildId}/tickets`, query ? { query } : {}),
  bumpTicketActivity: (guildId: string, channelId: string) =>
    call<void>(`/guilds/${guildId}/tickets/by-channel/${channelId}/activity`, { method: 'POST' }),
  slaDueTickets: () =>
    call<{ tickets: Array<Ticket & { staffRoleId: string | null }> }>(`/tickets/sla-due`),
  markSlaReminderSent: (ticketId: string) =>
    call<void>(`/tickets/${ticketId}/sla-reminder-sent`, { method: 'POST' }),
  idleDueTickets: () =>
    call<{
      tickets: Array<
        Ticket & { transcriptsEnabled: boolean; transcriptChannelId: string | null }
      >;
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
  deletePost: (postId: string) =>
    call<void>(`/posts/${postId}`, { method: 'DELETE' }),

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
  dueAnnouncements: () =>
    call<{ announcements: ScheduledAnnouncement[] }>(`/announcements/due`),
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
  ) =>
    call<GuildEvent>(`/guilds/${guildId}/events/${eventId}/rsvp`, { method: 'POST', body }),

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
    call<{ suggestions: Suggestion[] }>(
      `/guilds/${guildId}/suggestions`,
      query ? { query } : {},
    ),
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
  voteSuggestion: (
    guildId: string,
    suggestionId: string,
    body: { userId: string; vote: number },
  ) =>
    call<Suggestion>(`/guilds/${guildId}/suggestions/${suggestionId}/vote`, {
      method: 'POST',
      body,
    }),

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
  activeVoiceSessions: () =>
    call<{ sessions: VoiceSession[] }>(`/voice-sessions/active`),
};
