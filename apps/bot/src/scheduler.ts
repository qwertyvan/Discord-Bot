import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type APIEmbed,
  type Client,
  type Guild,
  type GuildMember,
  type GuildBasedChannel,
  type ForumChannel,
  type StageChannel,
  type TextChannel,
} from 'discord.js';
import { api, ApiError } from './api-client.js';
import { log } from './logger.js';
import { pollMessagePayload } from './util/poll-render.js';
import { giveawayMessagePayload } from './util/giveaway-render.js';
import { AttachmentBuilder } from 'discord.js';
import { fetchFeed } from './integrations/rss.js';
import { fetchStream } from './integrations/twitch.js';
import { feedHandlers, FEED_COLORS, type FeedItem } from './integrations/feeds/index.js';
import type { FeedKind } from '@discord-bot/shared';
import { renderTranscript } from './integrations/ticket-transcript.js';
import { activityBatcher } from './util/activity-batcher.js';
import { tickVoiceMinutes } from './events/insights.js';
import { tickQuestVoiceMinutes } from './events/quests.js';
import { questBus } from './util/quest-bus.js';
import { sweepStarboardDigest, STARBOARD_DIGEST_TICK_MS } from './util/starboard-digest.js';
import { sweepQuoteDigest, QUOTE_DIGEST_TICK_MS } from './util/quote-digest.js';
import { clearLockdown, listActiveLockdowns } from './util/anti-raid-state.js';

const REMINDER_TICK_MS = 10_000;
const POLL_TICK_MS = 30_000;
const POSTS_TICK_MS = 15_000;
const RSS_TICK_MS = 60_000;
const TWITCH_TICK_MS = 60_000;
const FEEDS_TICK_MS = 5 * 60_000;
const ANNOUNCE_TICK_MS = 30_000;
const GIVEAWAY_TICK_MS = 30_000;
const AUCTION_TICK_MS = 30_000;
const BIRTHDAY_TICK_MS = 5 * 60_000;
const SLA_TICK_MS = 60_000;
const IDLE_TICK_MS = 5 * 60_000;
const VOICE_XP_TICK_MS = 60_000;
const ACTIVITY_TICK_MS = 60_000;
const ACTIVITY_ROLES_TICK_MS = 24 * 60 * 60_000;
const BACKUP_TICK_MS = 24 * 60 * 60_000;
const APPEAL_SLA_TICK_MS = 60 * 60_000; // hourly
const MILESTONES_TICK_MS = 24 * 60 * 60_000; // daily
const PET_DECAY_TICK_MS = 60 * 60_000; // hourly
const QUESTS_TICK_MS = 60 * 60_000; // hourly
const MARKETPLACE_TICK_MS = 60 * 60_000; // hourly

const HEARTBEAT_TICK_MS = 30_000;

// Wrapper that bumps scheduler_ticks_total on the API's metrics registry
// before invoking the per-tick handler. Counter failures never block the tick.
function tick(name: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    api.postMetric('scheduler_ticks_total', { tick: name }).catch(() => undefined);
    await fn();
  };
}

async function sendHeartbeat(): Promise<void> {
  try {
    await api.postHeartbeat();
  } catch (err) {
    if (err instanceof ApiError) log.warn('heartbeat API error', { status: err.status });
  }
}

export function startScheduler(client: Client): void {
  setInterval(() => tick('reminders', () => fireDueReminders(client))().catch(noop), REMINDER_TICK_MS);
  setInterval(() => tick('polls', () => closeDuePolls(client))().catch(noop), POLL_TICK_MS);
  setInterval(() => tick('posts', () => deliverPendingPosts(client))().catch(noop), POSTS_TICK_MS);
  setInterval(() => tick('rss', () => pollRssFeeds())().catch(noop), RSS_TICK_MS);
  setInterval(() => tick('twitch', () => pollTwitchStreams())().catch(noop), TWITCH_TICK_MS);
  setInterval(() => tick('announce', () => fireDueAnnouncements())().catch(noop), ANNOUNCE_TICK_MS);
  setInterval(() => tick('birthday', () => fireBirthdays(client))().catch(noop), BIRTHDAY_TICK_MS);
  setInterval(() => tick('sla', () => sweepSlaReminders(client))().catch(noop), SLA_TICK_MS);
  setInterval(() => tick('idle', () => sweepIdleTickets(client))().catch(noop), IDLE_TICK_MS);
  setInterval(() => tick('voice-xp', () => awardActiveVoiceXp(client))().catch(noop), VOICE_XP_TICK_MS);
  setInterval(() => tick('activity', async () => {
    try { tickVoiceMinutes(client); } catch (err) { log.warn('tickVoiceMinutes error', { err: String(err) }); }
    try { tickQuestVoiceMinutes(client); } catch (err) { log.warn('tickQuestVoiceMinutes error', { err: String(err) }); }
    await activityBatcher.flushAll();
  })().catch(noop), ACTIVITY_TICK_MS);
  setInterval(() => tick('quests', () => sweepQuests())().catch(noop), QUESTS_TICK_MS);
  setInterval(() => tick('activity-roles', () => sweepActivityRoles(client))().catch(noop), ACTIVITY_ROLES_TICK_MS);
  setInterval(() => tick('backup', () => runDailySnapshots())().catch(noop), BACKUP_TICK_MS);
  setInterval(() => tick('appeal-sla', () => sweepStaleAppeals(client))().catch(noop), APPEAL_SLA_TICK_MS);
  setInterval(() => tick('giveaways', () => endDueGiveaways(client))().catch(noop), GIVEAWAY_TICK_MS);
  setInterval(() => tick('auctions', () => settleDueAuctions())().catch(noop), AUCTION_TICK_MS);
  setInterval(() => tick('starboard-digest', () => sweepStarboardDigest(client))().catch(noop), STARBOARD_DIGEST_TICK_MS);
  setInterval(() => tick('quote-digest', () => sweepQuoteDigest(client))().catch(noop), QUOTE_DIGEST_TICK_MS);
  setInterval(() => tick('counters', () => updateCounterChannels(client))().catch(noop), COUNTERS_TICK_MS);
  setInterval(() => tick('feeds', () => pollPublicFeeds())().catch(noop), FEEDS_TICK_MS);
  setInterval(() => tick('stale-threads', () => sweepStaleThreads(client))().catch(noop), STALE_THREAD_TICK_MS);
  setInterval(() => tick('stage-events', () => tickStageEvents(client))().catch(noop), STAGE_TICK_MS);
  setInterval(() => tick('anti-raid', () => sweepAntiRaid(client))().catch(noop), ANTI_RAID_TICK_MS);
  setInterval(() => tick('milestones', () => sweepMemberMilestones(client))().catch(noop), MILESTONES_TICK_MS);
  setInterval(() => tick('karaoke', () => pollDueKaraokeNights(client))().catch(noop), KARAOKE_TICK_MS);
  setInterval(() => tick('pet-decay', () => decayServerPets())().catch(noop), PET_DECAY_TICK_MS);
  setInterval(() => tick('marketplace', () => sweepExpiredListings())().catch(noop), MARKETPLACE_TICK_MS);
  setInterval(() => sendHeartbeat().catch(noop), HEARTBEAT_TICK_MS);
  setTimeout(() => {
    sendHeartbeat().catch(noop);
    tick('reminders', () => fireDueReminders(client))().catch(noop);
    tick('polls', () => closeDuePolls(client))().catch(noop);
    tick('posts', () => deliverPendingPosts(client))().catch(noop);
    tick('rss', () => pollRssFeeds())().catch(noop);
    tick('twitch', () => pollTwitchStreams())().catch(noop);
    tick('announce', () => fireDueAnnouncements())().catch(noop);
    tick('birthday', () => fireBirthdays(client))().catch(noop);
    tick('sla', () => sweepSlaReminders(client))().catch(noop);
    tick('idle', () => sweepIdleTickets(client))().catch(noop);
    tick('activity-roles', () => sweepActivityRoles(client))().catch(noop);
    tick('backup', () => runDailySnapshots())().catch(noop);
    tick('appeal-sla', () => sweepStaleAppeals(client))().catch(noop);
    tick('giveaways', () => endDueGiveaways(client))().catch(noop);
    tick('auctions', () => settleDueAuctions())().catch(noop);
    tick('starboard-digest', () => sweepStarboardDigest(client))().catch(noop);
    tick('quote-digest', () => sweepQuoteDigest(client))().catch(noop);
    tick('counters', () => updateCounterChannels(client))().catch(noop);
    tick('feeds', () => pollPublicFeeds())().catch(noop);
    tick('stale-threads', () => sweepStaleThreads(client))().catch(noop);
    tick('stage-events', () => tickStageEvents(client))().catch(noop);
    tick('anti-raid', () => sweepAntiRaid(client))().catch(noop);
    tick('milestones', () => sweepMemberMilestones(client))().catch(noop);
    tick('karaoke', () => pollDueKaraokeNights(client))().catch(noop);
    tick('pet-decay', () => decayServerPets())().catch(noop);
    tick('marketplace', () => sweepExpiredListings())().catch(noop);
  }, 5_000);
}

async function decayServerPets(): Promise<void> {
  try {
    await api.tickServerPetDecay();
  } catch (err) {
    if (err instanceof ApiError) log.warn('tickServerPetDecay API error', { status: err.status });
  }
}

async function sweepExpiredListings(): Promise<void> {
  try {
    const { expired } = await api.sweepExpiredListings();
    if (expired.length > 0) {
      log.info('marketplace: expired listings', { count: expired.length });
    }
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn('sweepExpiredListings API error', { status: err.status });
    }
  }
}

const ANTI_RAID_TICK_MS = 60_000;

const STALE_THREAD_TICK_MS = 60 * 60_000;
const STAGE_TICK_MS = 60_000;
const KARAOKE_TICK_MS = 60_000;

// Discord rate-limits channel renames at 2 per 10 minutes — anything more
// frequent than 5 minutes per channel risks hitting the 429 cap.
const COUNTERS_TICK_MS = 5 * 60_000;

function noop() {}

async function fireDueReminders(client: Client): Promise<void> {
  let due;
  try {
    due = await api.dueReminders();
  } catch (err) {
    if (err instanceof ApiError) log.warn('dueReminders API error', { status: err.status });
    return;
  }

  for (const r of due.reminders) {
    try {
      const lines = [
        `⏰ <@${r.userId}> reminder: ${r.content}`,
        `_Set <t:${Math.floor(new Date(r.createdAt).getTime() / 1000)}:R>._`,
      ].join('\n');

      let delivered = false;
      if (r.guildId && r.channelId) {
        const guild = client.guilds.cache.get(r.guildId);
        if (guild) {
          const channel = guild.channels.cache.get(r.channelId);
          if (channel && channel.type === ChannelType.GuildText) {
            await (channel as TextChannel).send({
              content: lines,
              allowedMentions: { users: [r.userId] },
            });
            delivered = true;
          }
        }
      }
      if (!delivered) {
        // Fall back to DM.
        const user = await client.users.fetch(r.userId).catch(() => null);
        if (user) {
          await user.send({ content: `⏰ Reminder: ${r.content}` }).catch(() => {
            log.info('Reminder DM closed', { userId: r.userId });
          });
        }
      }
      await api.deleteReminder(r.id).catch(() => {});
    } catch (err) {
      log.warn('Reminder delivery failed', { id: r.id, err: String(err) });
    }
  }
}

async function closeDuePolls(client: Client): Promise<void> {
  let due;
  try {
    due = await api.duePolls();
  } catch (err) {
    if (err instanceof ApiError) log.warn('duePolls API error', { status: err.status });
    return;
  }

  for (const poll of due.polls) {
    try {
      const closed = await api.updatePoll(poll.guildId, poll.id, { close: true });
      if (!closed.channelId || !closed.messageId) continue;
      const guild = client.guilds.cache.get(closed.guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(closed.channelId);
      if (!channel || channel.type !== ChannelType.GuildText) continue;
      const message = await (channel as TextChannel).messages
        .fetch(closed.messageId)
        .catch(() => null);
      if (message) await message.edit(pollMessagePayload(closed)).catch(() => {});
    } catch (err) {
      log.warn('Poll close failed', { id: poll.id, err: String(err) });
    }
  }
}

async function deliverPendingPosts(client: Client): Promise<void> {
  let due;
  try {
    due = await api.duePosts();
  } catch (err) {
    if (err instanceof ApiError) log.warn('duePosts API error', { status: err.status });
    return;
  }

  for (const post of due.posts) {
    try {
      const guild = client.guilds.cache.get(post.guildId);
      if (!guild) {
        await api.deletePost(post.id).catch(() => {});
        continue;
      }
      const channel = guild.channels.cache.get(post.channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await api.deletePost(post.id).catch(() => {});
        continue;
      }
      const payload: { content?: string; embeds?: APIEmbed[] } = {};
      if (post.content) payload.content = post.content;
      if (post.embedJson) payload.embeds = [post.embedJson as APIEmbed];
      else if (post.source && !post.content) {
        payload.content = `*${post.source}*`;
      }
      await (channel as TextChannel).send({
        ...payload,
        allowedMentions: { parse: [] },
      });
      await api.deletePost(post.id).catch(() => {});
    } catch (err) {
      log.warn('Pending post delivery failed', { id: post.id, err: String(err) });
      // Leave it in the queue; next tick will retry.
    }
  }
}

async function fireDueAnnouncements(): Promise<void> {
  let due;
  try {
    due = await api.dueAnnouncements();
  } catch (err) {
    if (err instanceof ApiError) log.warn('dueAnnouncements API error', { status: err.status });
    return;
  }
  for (const a of due.announcements) {
    try {
      await api.createPendingPost({
        guildId: a.guildId,
        channelId: a.channelId,
        ...(a.content ? { content: a.content } : {}),
        ...(a.embedJson ? { embedJson: a.embedJson } : {}),
        source: 'announcement',
      });
      await api.advanceAnnouncement(a.id);
    } catch (err) {
      log.warn('Announcement fire failed', { id: a.id, err: String(err) });
    }
  }
}

async function endDueGiveaways(client: Client): Promise<void> {
  let due;
  try {
    due = await api.dueGiveaways();
  } catch (err) {
    if (err instanceof ApiError) log.warn('dueGiveaways API error', { status: err.status });
    return;
  }

  for (const g of due.giveaways) {
    try {
      const ended = await api.endGiveaway(g.guildId, g.id);
      if (!ended.messageId || !ended.channelId) continue;
      const guild = client.guilds.cache.get(ended.guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(ended.channelId);
      if (!channel || channel.type !== ChannelType.GuildText) continue;
      const message = await (channel as TextChannel).messages
        .fetch(ended.messageId)
        .catch(() => null);
      if (!message) continue;
      const winnerMention =
        ended.winners.length > 0
          ? {
              content: `🎉 Congrats ${ended.winners
                .map((w) => `<@${w.userId}>`)
                .join(', ')} — you won **${ended.prize}**!`,
              allowedMentions: { users: ended.winners.map((w) => w.userId) },
            }
          : { content: `🏁 Giveaway for **${ended.prize}** ended — no eligible entries.` };
      await message
        .edit({ ...giveawayMessagePayload(ended, ended.entryCount), ...winnerMention })
        .catch(() => {});
    } catch (err) {
      log.warn('Giveaway end failed', { id: g.id, err: String(err) });
    }
  }
}

// Settle every auction past endsAt. The API does the heavy lifting:
// item escrow → winner inventory, currency escrow → seller balance, refund
// stale losing bids. We just poll, settle, and shrug at errors per item.
async function settleDueAuctions(): Promise<void> {
  let due;
  try {
    due = await api.dueAuctions();
  } catch (err) {
    if (err instanceof ApiError) log.warn('dueAuctions API error', { status: err.status });
    return;
  }
  for (const a of due.auctions) {
    try {
      await api.settleAuction(a.guildId, a.id);
    } catch (err) {
      log.warn('Auction settle failed', { id: a.id, err: String(err) });
    }
  }
}

async function fireBirthdays(client: Client): Promise<void> {
  // Walk every guild the bot is in and ask the API whether today's birthday
  // window has elapsed. The API enforces a once-per-day side-effect.
  for (const guild of client.guilds.cache.values()) {
    try {
      const result = await api.pollBirthdays(guild.id);
      if (!result.fired || !result.channelId || !result.template) continue;
      const channel = guild.channels.cache.get(result.channelId);
      if (!channel || channel.type !== ChannelType.GuildText) continue;
      const mentions = result.birthdays.map((b) => `<@${b.userId}>`).join(', ');
      if (!mentions) continue; // No birthdays today.
      const content = result.template
        .replaceAll('{users}', mentions)
        .replaceAll('{server}', guild.name);
      await (channel as TextChannel)
        .send({ content, allowedMentions: { users: result.birthdays.map((b) => b.userId) } })
        .catch((err) => log.warn('Birthday post failed', { guildId: guild.id, err: String(err) }));
    } catch (err) {
      log.warn('Birthday poll failed', { guildId: guild.id, err: String(err) });
    }
  }
}

async function pollRssFeeds(): Promise<void> {
  let due;
  try {
    due = await api.dueRssIntegrations();
  } catch (err) {
    if (err instanceof ApiError) log.warn('dueRssIntegrations API error', { status: err.status });
    return;
  }

  for (const sub of due.integrations) {
    if (!sub.rssUrl) continue;
    try {
      const items = await fetchFeed(sub.rssUrl);
      if (items.length === 0) {
        await api.updateRssState(sub.id, { lastSeenGuid: sub.lastSeenGuid }).catch(() => {});
        continue;
      }

      // First-run: just record the head GUID, don't fire a backlog of posts.
      if (!sub.lastSeenGuid) {
        await api.updateRssState(sub.id, { lastSeenGuid: items[0]!.guid }).catch(() => {});
        continue;
      }

      const newItems: typeof items = [];
      for (const item of items) {
        if (item.guid === sub.lastSeenGuid) break;
        newItems.push(item);
      }
      if (newItems.length === 0) {
        await api.updateRssState(sub.id, { lastSeenGuid: sub.lastSeenGuid }).catch(() => {});
        continue;
      }

      // Post oldest-first so the timeline reads naturally.
      for (const item of newItems.reverse()) {
        const embed = new EmbedBuilder()
          .setTitle(item.title.slice(0, 256) || '(no title)')
          .setColor(0x5865f2)
          .setFooter({ text: sub.name });
        if (item.link) embed.setURL(item.link);
        if (item.summary) embed.setDescription(item.summary);
        if (item.pubDate && !isNaN(item.pubDate.getTime())) embed.setTimestamp(item.pubDate);
        await api
          .createPendingPost({
            guildId: sub.guildId,
            channelId: sub.channelId,
            embedJson: embed.toJSON(),
            source: sub.name,
          })
          .catch((err) => log.warn('queue RSS post failed', { err: String(err) }));
      }
      await api.updateRssState(sub.id, { lastSeenGuid: items[0]!.guid }).catch(() => {});
    } catch (err) {
      log.warn('RSS poll failed', { id: sub.id, err: String(err) });
    }
  }
}

async function pollTwitchStreams(): Promise<void> {
  let due;
  try {
    due = await api.dueTwitchIntegrations();
  } catch (err) {
    if (err instanceof ApiError)
      log.warn('dueTwitchIntegrations API error', { status: err.status });
    return;
  }
  for (const sub of due.integrations) {
    if (!sub.twitchUsername) continue;
    try {
      const stream = await fetchStream(sub.guildId, sub.twitchUsername);
      const seenStreamId = sub.lastSeenGuid;
      if (stream && stream.id !== seenStreamId) {
        const embed = {
          title: `🔴 ${stream.user_name} is live`,
          url: `https://twitch.tv/${sub.twitchUsername}`,
          description: stream.title,
          color: 0x9146ff,
          fields: [
            { name: 'Game', value: stream.game_name || 'Unknown', inline: true },
            { name: 'Viewers', value: String(stream.viewer_count), inline: true },
          ],
          image: {
            url: stream.thumbnail_url.replace('{width}', '640').replace('{height}', '360'),
          },
          timestamp: stream.started_at,
        };
        await api.createPendingPost({
          guildId: sub.guildId,
          channelId: sub.channelId,
          embedJson: embed,
          source: `twitch:${sub.twitchUsername}`,
        });
        await api.updateTwitchState(sub.id, { streamId: stream.id });
      } else if (!stream && seenStreamId) {
        // Stream ended — clear our state so the next start is announced.
        await api.updateTwitchState(sub.id, { streamId: null });
      } else {
        await api.updateTwitchState(sub.id, { streamId: seenStreamId });
      }
    } catch (err) {
      log.warn('Twitch poll failed', { id: sub.id, err: String(err) });
    }
  }
}

async function pollPublicFeeds(): Promise<void> {
  let due;
  try {
    due = await api.enabledFeeds({ limit: 200 });
  } catch (err) {
    if (err instanceof ApiError) log.warn('enabledFeeds API error', { status: err.status });
    return;
  }

  for (const sub of due.feeds) {
    const kind = sub.kind as FeedKind;
    const handler = feedHandlers[kind];
    if (!handler) {
      log.warn('Unknown feed kind', { id: sub.id, kind: sub.kind });
      continue;
    }
    try {
      const { newItems, latestId } = await handler({
        id: sub.id,
        guildId: sub.guildId,
        channelId: sub.channelId,
        identifier: sub.identifier,
        lastItemId: sub.lastItemId,
      });

      // First-run: just record the head id so we don't backfill.
      if (!sub.lastItemId) {
        if (latestId) {
          await api
            .updateFeedLastItem(sub.guildId, sub.id, latestId)
            .catch((err) => log.warn('feed lastItem update failed', { id: sub.id, err: String(err) }));
        }
        continue;
      }

      if (newItems.length === 0) continue;

      // Post oldest-first so the timeline reads naturally.
      for (const item of [...newItems].reverse()) {
        const embed = buildFeedEmbed(kind, sub.identifier, item, sub.template ?? null);
        await api
          .createPendingPost({
            guildId: sub.guildId,
            channelId: sub.channelId,
            ...embed,
            source: `${kind}:${sub.identifier}`,
          })
          .catch((err) =>
            log.warn('queue feed post failed', { id: sub.id, err: String(err) }),
          );
      }

      if (latestId) {
        await api
          .updateFeedLastItem(sub.guildId, sub.id, latestId)
          .catch((err) => log.warn('feed lastItem update failed', { id: sub.id, err: String(err) }));
      }
    } catch (err) {
      // Failures per feed must not break the tick.
      log.warn('Feed poll failed', { id: sub.id, kind: sub.kind, err: String(err) });
    }
  }
}

function buildFeedEmbed(
  kind: FeedKind,
  identifier: string,
  item: FeedItem,
  template: string | null,
): { content?: string; embedJson: APIEmbed } {
  const embed = new EmbedBuilder()
    .setTitle(item.title.slice(0, 256) || '(no title)')
    .setColor(FEED_COLORS[kind]);
  if (item.url) embed.setURL(item.url);
  if (item.contentSnippet) embed.setDescription(item.contentSnippet.slice(0, 4000));
  if (item.author) embed.setAuthor({ name: item.author.slice(0, 256) });
  if (item.publishedAt && !Number.isNaN(item.publishedAt.getTime())) {
    embed.setTimestamp(item.publishedAt);
  }
  embed.setFooter({ text: `${kind} · ${identifier}`.slice(0, 2048) });

  if (template) {
    const content = template
      .replaceAll('{title}', item.title)
      .replaceAll('{url}', item.url)
      .replaceAll('{author}', item.author ?? identifier)
      .replaceAll('{identifier}', identifier)
      .replaceAll('{kind}', kind)
      .slice(0, 2000);
    return { content, embedJson: embed.toJSON() };
  }
  return { embedJson: embed.toJSON() };
}

async function sweepSlaReminders(client: Client): Promise<void> {
  let due;
  try {
    due = await api.slaDueTickets();
  } catch (err) {
    if (err instanceof ApiError) log.warn('slaDueTickets API error', { status: err.status });
    return;
  }
  for (const ticket of due.tickets) {
    try {
      const guild = client.guilds.cache.get(ticket.guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(ticket.channelId);
      if (!channel || !channel.isTextBased()) continue;
      const mention = ticket.staffRoleId ? `<@&${ticket.staffRoleId}> ` : '';
      await (channel as TextChannel).send({
        content: `${mention}⏰ Ticket #${ticket.number} has been waiting for a staff response.`,
        allowedMentions: ticket.staffRoleId ? { roles: [ticket.staffRoleId] } : { parse: [] },
      });
      await api.markSlaReminderSent(ticket.id).catch(() => {});
    } catch (err) {
      log.warn('SLA reminder failed', { ticketId: ticket.id, err: String(err) });
    }
  }
}

async function sweepStaleAppeals(client: Client): Promise<void> {
  let due;
  try {
    due = await api.staleAppeals();
  } catch (err) {
    if (err instanceof ApiError) log.warn('staleAppeals API error', { status: err.status });
    return;
  }
  for (const appeal of due.appeals) {
    try {
      const guild = client.guilds.cache.get(appeal.guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(appeal.escalateChannelId);
      if (!channel || channel.type !== ChannelType.GuildText) continue;
      const ageHours = Math.floor(
        (Date.now() - new Date(appeal.createdAt).getTime()) / 3_600_000,
      );
      const embed = new EmbedBuilder()
        .setTitle('⏰ Stale appeal awaiting review')
        .setColor(0xf59e0b)
        .setDescription(appeal.message.slice(0, 1000))
        .addFields(
          { name: 'Appeal ID', value: `\`${appeal.id}\``, inline: true },
          { name: 'User', value: `<@${appeal.userId}>`, inline: true },
          { name: 'Age', value: `${ageHours}h`, inline: true },
        )
        .setTimestamp(new Date(appeal.createdAt));
      if (appeal.modActionId) {
        embed.addFields({ name: 'Mod action', value: `\`${appeal.modActionId}\``, inline: false });
      }
      await (channel as TextChannel)
        .send({ embeds: [embed], allowedMentions: { parse: [] } })
        .catch((err) => log.warn('Stale appeal post failed', { id: appeal.id, err: String(err) }));
    } catch (err) {
      log.warn('Stale appeal sweep failed', { id: appeal.id, err: String(err) });
    }
  }
}

async function sweepIdleTickets(client: Client): Promise<void> {
  let due;
  try {
    due = await api.idleDueTickets();
  } catch (err) {
    if (err instanceof ApiError) log.warn('idleDueTickets API error', { status: err.status });
    return;
  }
  for (const ticket of due.tickets) {
    try {
      const guild = client.guilds.cache.get(ticket.guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(ticket.channelId);
      if (!channel || !channel.isTextBased()) continue;

      let transcriptBuffer: Buffer | null = null;
      if (ticket.transcriptsEnabled) {
        try {
          const html = await renderTranscript(channel as TextChannel, {
            title: `Ticket #${ticket.number}`,
            openedAt: ticket.openedAt,
            closedAt: new Date().toISOString(),
            closedBy: 'auto-close (idle)',
          });
          transcriptBuffer = Buffer.from(html, 'utf8');
        } catch (err) {
          log.warn('Transcript render failed', { ticketId: ticket.id, err: String(err) });
        }
      }

      await (channel as TextChannel).send({
        content: `🔒 Auto-closing ticket #${ticket.number} due to inactivity.`,
        allowedMentions: { parse: [] },
      });

      if (transcriptBuffer) {
        const target = ticket.transcriptChannelId
          ? (guild.channels.cache.get(ticket.transcriptChannelId) as TextChannel | undefined)
          : (channel as TextChannel);
        if (target?.isTextBased()) {
          await (target as TextChannel)
            .send({
              content: `📝 Transcript for ticket #${ticket.number}`,
              files: [
                new AttachmentBuilder(transcriptBuffer, { name: `ticket-${ticket.number}.html` }),
              ],
            })
            .catch(() => {});
        }
      }

      await api.updateTicket(ticket.guildId, ticket.id, {
        status: 'closed',
        closedBy: client.user!.id,
        closeReason: 'Auto-closed (idle)',
      });
      if ('isThread' in channel && channel.isThread()) {
        await channel.setArchived(true, 'Auto-close idle ticket').catch(() => {});
      }
    } catch (err) {
      log.warn('Idle auto-close failed', { ticketId: ticket.id, err: String(err) });
    }
  }
}

// Per-minute voice XP for members in populated voice channels. We pull the
// list of currently-open voice sessions from the API, then for each one
// check the live channel state to confirm there are ≥2 humans and the
// member isn't fully deafened before awarding XP. We use the leveling
// awardVoiceXp helper with minutes=1 so the existing XP/level-up logic
// (role rewards, leveled-up announce) keeps applying.
async function awardActiveVoiceXp(client: Client): Promise<void> {
  let active;
  try {
    active = await api.activeVoiceSessions();
  } catch (err) {
    if (err instanceof ApiError) log.warn('activeVoiceSessions API error', { status: err.status });
    return;
  }

  // Cache per-guild level config for this tick to avoid hammering the API.
  const configCache = new Map<
    string,
    { voiceXpEnabled: boolean; voiceXpPerMinute: number; noXpRoleIds: string[] } | null
  >();
  async function getConfig(guildId: string) {
    if (configCache.has(guildId)) return configCache.get(guildId) ?? null;
    try {
      const cfg = await api.getLevelConfig(guildId);
      const entry = {
        voiceXpEnabled: cfg.voiceXpEnabled,
        voiceXpPerMinute: cfg.voiceXpPerMinute,
        noXpRoleIds: cfg.noXpRoleIds,
      };
      configCache.set(guildId, entry);
      return entry;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        configCache.set(guildId, null);
        return null;
      }
      log.warn('getLevelConfig failed', { guildId, err: String(err) });
      configCache.set(guildId, null);
      return null;
    }
  }

  for (const session of active.sessions) {
    try {
      const cfg = await getConfig(session.guildId);
      if (!cfg || !cfg.voiceXpEnabled || cfg.voiceXpPerMinute <= 0) continue;

      const guild = client.guilds.cache.get(session.guildId);
      if (!guild) continue;

      const channel = guild.channels.cache.get(session.channelId);
      if (!channel || !channel.isVoiceBased()) continue;

      const member = channel.members.get(session.userId);
      if (!member) continue;
      if (member.user.bot) continue;
      if (member.voice.selfDeaf || member.voice.deaf) continue;
      // Exclude no-XP roles.
      if (cfg.noXpRoleIds.some((roleId) => member.roles.cache.has(roleId))) continue;

      // Need ≥2 non-bot humans in the channel for it to count as populated.
      const humans = channel.members.filter((m) => !m.user.bot).size;
      if (humans < 2) continue;

      await api.awardVoiceXp(session.guildId, { userId: session.userId, minutes: 1 });
    } catch (err) {
      log.warn('awardActiveVoiceXp tick failed', {
        sessionId: session.id,
        err: String(err),
      });
    }
  }
}
/**
 * Daily reconciliation of activity-role rules across every guild the bot
 * is in. For each enabled rule we pull the member-activity rows over the
 * configured window and grant or revoke the role accordingly. Prune is
 * intentionally NOT performed here — it runs only via `/prune run`.
 */
async function sweepActivityRoles(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await reconcileGuildActivityRoles(guild);
    } catch (err) {
      log.warn('activity-role sweep failed', { guildId: guild.id, err: String(err) });
    }
  }
}

async function reconcileGuildActivityRoles(guild: Guild): Promise<void> {
  let rules;
  try {
    rules = (await api.listActivityRules(guild.id)).rules.filter((r) => r.enabled);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return;
    log.warn('listActivityRules failed', { guildId: guild.id, err: String(err) });
    return;
  }
  if (rules.length === 0) return;

  // Pull the broadest window so we only hit the API once per guild, then
  // filter per-rule below using each rule's windowDays.
  const maxWindow = Math.max(...rules.map((r) => r.windowDays));
  let members;
  try {
    members = (await api.listMemberActivity(guild.id, { sinceDays: maxWindow, limit: 5000 }))
      .members;
  } catch (err) {
    log.warn('listMemberActivity failed', { guildId: guild.id, err: String(err) });
    return;
  }
  const activityByUser = new Map(members.map((m) => [m.userId, m]));

  // Make sure every potential target is in cache so member.roles works.
  await guild.members.fetch().catch(() => {});

  for (const rule of rules) {
    const cutoffMs = Date.now() - rule.windowDays * 86_400_000;
    for (const member of guild.members.cache.values()) {
      if (member.user.bot) continue;
      try {
        const activity = activityByUser.get(member.id);
        const inWindow =
          activity &&
          new Date(activity.lastActiveAt).getTime() >= cutoffMs;
        const messages = inWindow ? activity.messages : 0;
        const voiceMinutes = inWindow ? activity.voiceMinutes : 0;
        const meets =
          messages >= rule.minMessages && voiceMinutes >= rule.minVoiceMinutes;
        const has = member.roles.cache.has(rule.roleId);

        if (rule.action === 'grant') {
          if (meets && !has) {
            await member.roles.add(rule.roleId, 'Activity-role grant');
          } else if (!meets && has) {
            await member.roles.remove(rule.roleId, 'Activity-role grant lost');
          }
        } else {
          // 'revoke': remove the role when the activity floor is met
          // (i.e. an opt-in "minimum-activity demotion" gate).
          if (meets && has) {
            await member.roles.remove(rule.roleId, 'Activity-role revoke');
          }
        }
      } catch (err) {
        log.warn('activity-role apply failed', {
          guildId: guild.id,
          userId: member.id,
          roleId: rule.roleId,
          err: String(err),
        });
      }
    }
  }
}

// ─── Counter channels ──────────────────────────────────────────────────
function renamableChannel(channel: GuildBasedChannel | undefined): boolean {
  if (!channel) return false;
  return (
    channel.type === ChannelType.GuildVoice ||
    channel.type === ChannelType.GuildStageVoice ||
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildCategory ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.GuildForum
  );
}

function computeCounterValue(
  client: Client,
  type: string,
  guildId: string,
): number | null {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;
  switch (type) {
    case 'members':
      return guild.memberCount;
    case 'humans': {
      const bots = guild.members.cache.filter((m) => m.user.bot).size;
      // memberCount is authoritative; subtract cached bots as the best
      // available approximation when not all members are cached.
      return Math.max(0, guild.memberCount - bots);
    }
    case 'bots':
      return guild.members.cache.filter((m) => m.user.bot).size;
    case 'online':
      return guild.presences.cache.filter(
        (p) => p.status === 'online' || p.status === 'idle' || p.status === 'dnd',
      ).size;
    case 'boosts':
      return guild.premiumSubscriptionCount ?? 0;
    default:
      return null;
  }
}

function renderTemplate(template: string, count: number): string {
  return template.replaceAll('{count}', count.toLocaleString());
}

async function updateCounterChannels(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    let counters;
    try {
      counters = await api.listCounterChannels(guild.id);
    } catch (err) {
      if (err instanceof ApiError) {
        log.warn('listCounterChannels API error', { status: err.status, guildId: guild.id });
      }
      continue;
    }
    for (const counter of counters.counters) {
      try {
        const channel = guild.channels.cache.get(counter.channelId);
        if (!renamableChannel(channel)) continue;
        const value = computeCounterValue(client, counter.type, guild.id);
        if (value === null) continue;
        const rendered = renderTemplate(counter.template, value).slice(0, 100);
        if (channel!.name === rendered) continue;
        await channel!.setName(rendered, `Counter update (${counter.type})`);
      } catch (err) {
        // Channel renames are heavily rate-limited; log and continue so a
        // single 429 doesn't stall the rest of the guild's counters.
        log.warn('Counter rename failed', {
          guildId: guild.id,
          channelId: counter.channelId,
          err: String(err),
        });
      }
    }
  }
}

/**
 * Walk every guild the bot is in; for guilds whose stale-thread policy is
 * enabled, scan every forum channel and archive/lock active threads whose
 * lastMessage is older than `idleHours`.
 */
async function sweepStaleThreads(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    let policy;
    try {
      policy = await api.getStaleThreadPolicy(guild.id);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status !== 404) log.warn('staleThreadPolicy fetch failed', { guildId: guild.id, status: err.status });
      }
      continue;
    }
    if (!policy.enabled) continue;

    const cutoff = Date.now() - policy.idleHours * 3_600_000;
    const forums = guild.channels.cache.filter(
      (c): c is ForumChannel => c.type === ChannelType.GuildForum,
    );
    for (const forum of forums.values()) {
      try {
        const active = await forum.threads.fetchActive().catch(() => null);
        if (!active) continue;
        for (const thread of active.threads.values()) {
          if (thread.archived || thread.locked) continue;
          // Discord exposes lastMessageId as a snowflake; derive timestamp.
          const lastMessageId = thread.lastMessageId;
          let activityMs = thread.createdTimestamp ?? 0;
          if (lastMessageId) {
            // Snowflake timestamp: (id >> 22) + Discord epoch (2015-01-01).
            try {
              activityMs = Number(BigInt(lastMessageId) >> 22n) + 1_420_070_400_000;
            } catch {
              // fall through to createdTimestamp
            }
          }
          if (activityMs > cutoff) continue;
          if (policy.action === 'lock') {
            await thread.setLocked(true, 'Stale thread policy').catch(() => {});
            await thread.setArchived(true, 'Stale thread policy').catch(() => {});
          } else {
            await thread.setArchived(true, 'Stale thread policy').catch(() => {});
          }
        }
      } catch (err) {
        log.warn('Stale thread sweep failed', {
          guildId: guild.id,
          forumId: forum.id,
          err: String(err),
        });
      }
    }
  }
}

/**
 * Compute prune candidates for a guild using the bot's local member cache
 * and the activity table. Used by `/prune preview` and `/prune run`.
 * Skips the guild owner, anyone with ManageGuild, anyone holding an
 * excluded role, anyone active inside the inactive-days window, and bots.
 */
export interface PruneCandidate {
  member: GuildMember;
  lastActiveAt: Date | null;
}

export async function computePruneCandidates(
  guild: Guild,
): Promise<{
  enabled: boolean;
  inactiveDays: number;
  notifyDm: boolean;
  candidates: PruneCandidate[];
}> {
  const policy = await api.getPrunePolicy(guild.id);
  await guild.members.fetch().catch(() => {});

  // Build a lookup of every recently-active member so we can quickly skip
  // anyone who's *not* a candidate.
  const recent = new Map<string, Date>();
  try {
    const rows = await api.listMemberActivity(guild.id, {
      sinceDays: policy.inactiveDays,
      limit: 5000,
    });
    for (const r of rows.members) {
      recent.set(r.userId, new Date(r.lastActiveAt));
    }
  } catch (err) {
    log.warn('prune listMemberActivity failed', { guildId: guild.id, err: String(err) });
  }

  const excluded = new Set(policy.excludeRoleIds);
  const candidates: PruneCandidate[] = [];

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    if (member.id === guild.ownerId) continue;
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) continue;
    if (member.roles.cache.some((r) => excluded.has(r.id))) continue;
    if (recent.has(member.id)) continue;
    candidates.push({ member, lastActiveAt: null });
  }

  return {
    enabled: policy.enabled,
    inactiveDays: policy.inactiveDays,
    notifyDm: policy.notifyDm,
    candidates,
  };
}
async function runDailySnapshots(): Promise<void> {
  let policies;
  try {
    policies = await api.listAutoSnapshotPolicies();
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn('listAutoSnapshotPolicies API error', { status: err.status });
    }
    return;
  }
  if (policies.policies.length === 0) return;

  const label = `auto-${new Date().toISOString().slice(0, 10)}`;
  for (const policy of policies.policies) {
    try {
      await api.createSnapshot(policy.guildId, { label });
      const { pruned } = await api.pruneSnapshots(policy.guildId, policy.retentionDays);
      if (pruned > 0) {
        log.info('Pruned old snapshots', { guildId: policy.guildId, pruned });
      }
    } catch (err) {
      log.warn('Daily snapshot failed', { guildId: policy.guildId, err: String(err) });
    }
  }
}

const LIVE_STAGE_MAX_AGE_MS = 2 * 3_600_000;

/**
 * Stage event tick: starts any 'scheduled' events whose time has come (creates
 * the StageInstance, flips status to 'live'), then ends any 'live' event whose
 * underlying StageInstance is gone or which has run for over 2 hours.
 */
async function tickStageEvents(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    // Start due scheduled events.
    let scheduled;
    try {
      scheduled = await api.listStageEvents(guild.id, { status: 'scheduled', limit: 25 });
    } catch (err) {
      if (err instanceof ApiError && err.status !== 404)
        log.warn('listStageEvents scheduled failed', { guildId: guild.id, status: err.status });
      scheduled = { events: [] };
    }
    const now = Date.now();
    for (const ev of scheduled.events) {
      if (new Date(ev.scheduledFor).getTime() > now) continue;
      try {
        const channel = await guild.channels.fetch(ev.channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildStageVoice) {
          await api.updateStageEventStatus(guild.id, ev.id, 'cancelled').catch(() => {});
          continue;
        }
        await guild.stageInstances
          .create((channel as StageChannel).id, { topic: ev.topic })
          .catch((err: unknown) => {
            log.warn('stageInstance create failed', { eventId: ev.id, err: String(err) });
          });
        await api.updateStageEventStatus(guild.id, ev.id, 'live').catch(() => {});
      } catch (err) {
        log.warn('Stage event start failed', { eventId: ev.id, err: String(err) });
      }
    }

    // End live events that are stale or whose stage instance is gone.
    let live;
    try {
      live = await api.listStageEvents(guild.id, { status: 'live', limit: 25 });
    } catch (err) {
      if (err instanceof ApiError && err.status !== 404)
        log.warn('listStageEvents live failed', { guildId: guild.id, status: err.status });
      live = { events: [] };
    }
    for (const ev of live.events) {
      try {
        const startedAt = new Date(ev.scheduledFor).getTime();
        const tooOld = now - startedAt > LIVE_STAGE_MAX_AGE_MS;
        const stage = await guild.stageInstances.fetch(ev.channelId).catch(() => null);
        if (!tooOld && stage) continue;
        // Tear down (best-effort) and mark ended.
        if (stage) await stage.delete().catch(() => {});
        await api.updateStageEventStatus(guild.id, ev.id, 'ended').catch(() => {});
        if (ev.recapChannelId) {
          const recap = guild.channels.cache.get(ev.recapChannelId);
          if (recap && recap.type === ChannelType.GuildText) {
            const embed = new EmbedBuilder()
              .setTitle(`Stage recap: ${ev.topic}`)
              .setColor(0x5865f2)
              .setDescription(
                [
                  `**Channel:** <#${ev.channelId}>`,
                  `**Scheduled:** <t:${Math.floor(startedAt / 1000)}:F>`,
                  ev.speakerIds.length
                    ? `**Speakers:** ${ev.speakerIds.map((id) => `<@${id}>`).join(', ')}`
                    : '',
                ]
                  .filter(Boolean)
                  .join('\n'),
              )
              .setTimestamp(new Date());
            await (recap as TextChannel)
              .send({ embeds: [embed], allowedMentions: { parse: [] } })
              .catch(() => {});
          }
        }
      } catch (err) {
        log.warn('Stage event end failed', { eventId: ev.id, err: String(err) });
      }
    }
  }
}

/**
 * Daily member-milestone sweep. For each guild whose MilestoneConfig is
 * enabled:
 *   1. Joinaversary — members whose joinedAt month+day matches today and
 *      whose joinedAt year is strictly older than the current year get
 *      a celebratory embed in joinaversaryChannelId. Currency reward is
 *      paid out via the economy api when configured.
 *   2. Tenure roles — every TenureRoleRule is reconciled: members whose
 *      (now - joinedAt) ≥ daysRequired and who don't yet hold the role
 *      get it granted. The MilestoneAward ledger is consulted to keep
 *      this idempotent across ticks.
 */
export async function sweepMemberMilestones(client: Client): Promise<void> {
  let enabled;
  try {
    enabled = await api.listEnabledMilestoneConfigs();
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn('listEnabledMilestoneConfigs API error', { status: err.status });
    }
    return;
  }
  if (enabled.configs.length === 0) return;

  const today = new Date();
  const todayMonth = today.getUTCMonth() + 1;
  const todayDay = today.getUTCDate();
  const todayYear = today.getUTCFullYear();

  for (const cfg of enabled.configs) {
    const guild = client.guilds.cache.get(cfg.guildId);
    if (!guild) continue;

    // Make sure members are cached so joinedAt is populated.
    await guild.members.fetch().catch(() => {});

    let tenureRules: Awaited<ReturnType<typeof api.listTenureRoles>>['rules'] = [];
    try {
      tenureRules = (await api.listTenureRoles(cfg.guildId)).rules;
    } catch (err) {
      log.warn('listTenureRoles failed', { guildId: cfg.guildId, err: String(err) });
    }

    for (const member of guild.members.cache.values()) {
      if (member.user.bot) continue;
      const joinedAt = member.joinedAt;
      if (!joinedAt) continue;

      // ── Joinaversary ──
      const joinedMonth = joinedAt.getUTCMonth() + 1;
      const joinedDay = joinedAt.getUTCDate();
      const joinedYear = joinedAt.getUTCFullYear();
      if (
        cfg.joinaversaryChannelId &&
        joinedMonth === todayMonth &&
        joinedDay === todayDay &&
        joinedYear < todayYear
      ) {
        const years = todayYear - joinedYear;
        await fireJoinaversary(guild, member, cfg, years).catch((err) =>
          log.warn('joinaversary failed', {
            guildId: cfg.guildId,
            userId: member.id,
            err: String(err),
          }),
        );
      }

      // ── Tenure roles ──
      if (tenureRules.length > 0) {
        const tenureMs = Date.now() - joinedAt.getTime();
        const tenureDays = Math.floor(tenureMs / 86_400_000);
        for (const rule of tenureRules) {
          if (tenureDays < rule.daysRequired) continue;
          if (member.roles.cache.has(rule.roleId)) continue;
          // Idempotency: don't re-grant if we already awarded this rule.
          let already;
          try {
            already = await api.listMilestoneAwards(cfg.guildId, {
              userId: member.id,
              kind: 'tenure',
              limit: 50,
            });
          } catch (err) {
            log.warn('listMilestoneAwards (tenure) failed', {
              guildId: cfg.guildId,
              userId: member.id,
              err: String(err),
            });
            continue;
          }
          const seen = already.awards.some(
            (a) => (a.payload as { ruleId?: string } | null)?.ruleId === rule.id,
          );
          if (seen) continue;
          try {
            await member.roles.add(rule.roleId, `Tenure role (${rule.daysRequired}d)`);
            await api.recordMilestoneAward(cfg.guildId, {
              userId: member.id,
              kind: 'tenure',
              payload: { ruleId: rule.id, daysRequired: rule.daysRequired },
            });
          } catch (err) {
            log.warn('tenure role grant failed', {
              guildId: cfg.guildId,
              userId: member.id,
              roleId: rule.roleId,
              err: String(err),
            });
          }
        }
      }
    }
  }
}

async function fireJoinaversary(
  guild: Guild,
  member: GuildMember,
  cfg: { guildId: string; joinaversaryChannelId: string | null; joinaversaryTemplate: string | null; joinaversaryReward: number },
  years: number,
): Promise<void> {
  if (!cfg.joinaversaryChannelId) return;
  // Idempotency: skip if we already fired this calendar year.
  try {
    const already = await api.listMilestoneAwards(cfg.guildId, {
      userId: member.id,
      kind: 'joinaversary',
      limit: 20,
    });
    const yearNow = new Date().getUTCFullYear();
    const seen = already.awards.some(
      (a) => (a.payload as { year?: number } | null)?.year === yearNow,
    );
    if (seen) return;
  } catch {
    // Fall through — better to risk a double-post than skip everyone on a
    // transient API blip.
  }

  const channel = guild.channels.cache.get(cfg.joinaversaryChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const template =
    cfg.joinaversaryTemplate ??
    '🎉 Happy {years}-year joinaversary, {user}! Thanks for being part of **{server}**.';
  const content = template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.displayName)
    .replaceAll('{server}', guild.name)
    .replaceAll('{years}', String(years));

  const embed = new EmbedBuilder()
    .setTitle('🎂 Joinaversary')
    .setDescription(content)
    .setColor(0xf59e0b)
    .setThumbnail(member.user.displayAvatarURL({ size: 256, extension: 'png' }))
    .setTimestamp(new Date());

  await (channel as TextChannel)
    .send({
      embeds: [embed],
      allowedMentions: { users: [member.id] },
    })
    .catch((err) => log.warn('joinaversary send failed', { guildId: guild.id, err: String(err) }));

  if (cfg.joinaversaryReward > 0) {
    await api
      .adjustBalance(guild.id, member.id, cfg.joinaversaryReward)
      .catch((err) =>
        log.warn('joinaversary reward failed', {
          guildId: guild.id,
          userId: member.id,
          err: String(err),
        }),
      );
  }

  await api
    .recordMilestoneAward(guild.id, {
      userId: member.id,
      kind: 'joinaversary',
      payload: { year: new Date().getUTCFullYear(), years },
    })
    .catch((err) =>
      log.warn('joinaversary recordAward failed', {
        guildId: guild.id,
        userId: member.id,
        err: String(err),
      }),
    );
}

/**
 * Hourly quest tick. Flushes any debounced progress events still queued
 * in the per-guild questBus and asks the API to delete UserQuest rows
 * whose deadline has passed without a claim — so the next /quest list
 * can pull in a fresh assignment from the enabled templates.
 */
async function sweepQuests(): Promise<void> {
  try {
    await questBus.flushAll();
  } catch (err) {
    log.warn('questBus.flushAll failed', { err: String(err) });
  }
  try {
    await api.expireUserQuests();
  } catch (err) {
    if (err instanceof ApiError) {
      log.warn('expireUserQuests API error', { status: err.status });
    } else {
      log.warn('expireUserQuests error', { err: String(err) });
    }
  }
}

/**
 * Expires in-memory lockdowns and any pending captcha challenges whose
 * deadlines have passed. Called once a minute.
 */
async function sweepAntiRaid(client: Client): Promise<void> {
  // ── Expire lockdowns ──
  const now = Date.now();
  for (const active of listActiveLockdowns()) {
    if (active.expiresAt > now) continue;
    try {
      await api.endLockdown(active.guildId, active.id, active.blocked);
    } catch (err) {
      if (err instanceof ApiError) {
        log.warn('endLockdown API error', { id: active.id, status: err.status });
      }
    }
    clearLockdown(active.guildId);
    log.info('anti-raid: lockdown expired', {
      guildId: active.guildId,
      id: active.id,
      blocked: active.blocked,
    });
  }

  // ── Expire pending captcha challenges ──
  let expired;
  try {
    expired = await api.expiredPendingVerifications();
  } catch (err) {
    if (err instanceof ApiError && err.status !== 404) {
      log.warn('expiredPendingVerifications API error', { status: err.status });
    }
    return;
  }
  for (const p of expired.pending) {
    try {
      const user = await client.users.fetch(p.userId).catch(() => null);
      if (user) {
        await user
          .send({
            content:
              '⌛ Your verification captcha expired. Re-join the server or ask a moderator to re-issue a new challenge.',
          })
          .catch(() => {});
      }
    } catch (err) {
      log.warn('anti-raid: expiry DM failed', { userId: p.userId, err: String(err) });
    }
    await api.deletePendingVerification(p.guildId, p.userId).catch(() => {});
  }
}

/**
 * Drives karaoke night state transitions. The API's /karaoke-nights/due
 * endpoint partitions due nights into three buckets:
 *   - t15: scheduled and within T-15m, never announced — post a heads-up
 *     and flip announcedT15 so we don't double-fire.
 *   - starting: scheduled and past startTime — post the "now live" ping and
 *     flip status → live.
 *   - endingLive: live for longer than the 4h cutoff — flip to ended and
 *     post the recap embed.
 * Channel/message lookups are best-effort; missing channels are warned and
 * the API state still advances so we don't re-fire on the next tick.
 */
async function pollDueKaraokeNights(client: Client): Promise<void> {
  let due;
  try {
    due = await api.dueKaraokeNights();
  } catch (err) {
    if (err instanceof ApiError) log.warn('dueKaraokeNights API error', { status: err.status });
    return;
  }

  for (const night of due.t15) {
    try {
      const guild = client.guilds.cache.get(night.guildId);
      if (!guild) continue;
      const channelId = night.announceChannelId;
      if (channelId) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.type === ChannelType.GuildText) {
          await (channel as TextChannel)
            .send({
              content: `🎤 **${night.title}** starts <t:${Math.floor(
                new Date(night.scheduledFor).getTime() / 1000,
              )}:R> in <#${night.voiceChannelId}>. Host: <@${night.hostId}>`,
              allowedMentions: { users: [night.hostId] },
            })
            .catch(() => undefined);
        }
      }
      await api
        .updateKaraokeNight(night.guildId, night.id, { announcedT15: true })
        .catch(() => undefined);
    } catch (err) {
      log.warn('Karaoke T-15 ping failed', { id: night.id, err: String(err) });
    }
  }

  for (const night of due.starting) {
    try {
      const guild = client.guilds.cache.get(night.guildId);
      // Always flip status so we don't busy-loop the API even if the guild
      // is no longer reachable.
      await api
        .updateKaraokeNight(night.guildId, night.id, { status: 'live' })
        .catch(() => undefined);
      if (!guild) continue;
      const channelId = night.announceChannelId;
      if (channelId) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.type === ChannelType.GuildText) {
          await (channel as TextChannel)
            .send({
              content: `🎤 **${night.title}** is starting **now** in <#${night.voiceChannelId}>! Hop in 🎶`,
              allowedMentions: { parse: [] },
            })
            .catch(() => undefined);
        }
      }
    } catch (err) {
      log.warn('Karaoke start ping failed', { id: night.id, err: String(err) });
    }
  }

  for (const night of due.endingLive) {
    try {
      const guild = client.guilds.cache.get(night.guildId);
      // Refresh so the recap reflects what actually played.
      const detail = await api.getKaraokeNight(night.guildId, night.id).catch(() => null);
      await api
        .updateKaraokeNight(night.guildId, night.id, { status: 'ended' })
        .catch(() => undefined);
      if (!guild || !detail) continue;
      const recapId = detail.recapChannelId ?? detail.announceChannelId;
      if (!recapId) continue;
      const recap = guild.channels.cache.get(recapId);
      if (!recap || recap.type !== ChannelType.GuildText) continue;
      const played = (detail.songs ?? []).filter((s) => s.playedAt);
      const counts = detail.rsvpCounts ?? { yes: 0, maybe: 0, no: 0 };
      const embed = new EmbedBuilder()
        .setTitle(`🏁 Karaoke recap: ${detail.title}`)
        .setColor(0x5865f2)
        .setDescription(
          [
            `**Host:** <@${detail.hostId}>`,
            `**Voice:** <#${detail.voiceChannelId}>`,
            `**RSVPs:** ✅ ${counts.yes} · 🤔 ${counts.maybe} · ❌ ${counts.no}`,
            `**Songs played:** ${played.length}`,
          ].join('\n'),
        )
        .setTimestamp(new Date());
      if (played.length) {
        embed.addFields({
          name: 'Set list',
          value: played
            .slice(0, 15)
            .map((s, i) => `${i + 1}. ${s.title} — <@${s.submitterId}>`)
            .join('\n'),
        });
      }
      await (recap as TextChannel)
        .send({ embeds: [embed], allowedMentions: { parse: [] } })
        .catch(() => undefined);
    } catch (err) {
      log.warn('Karaoke recap failed', { id: night.id, err: String(err) });
    }
  }
}
