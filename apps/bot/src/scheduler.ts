import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type APIEmbed,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { api, ApiError } from './api-client.js';
import { log } from './logger.js';
import { pollMessagePayload } from './util/poll-render.js';
import { AttachmentBuilder } from 'discord.js';
import { fetchFeed } from './integrations/rss.js';
import { fetchStream } from './integrations/twitch.js';
import { renderTranscript } from './integrations/ticket-transcript.js';
import { activityBatcher } from './util/activity-batcher.js';
import { tickVoiceMinutes } from './events/insights.js';

const REMINDER_TICK_MS = 10_000;
const POLL_TICK_MS = 30_000;
const POSTS_TICK_MS = 15_000;
const RSS_TICK_MS = 60_000;
const TWITCH_TICK_MS = 60_000;
const ANNOUNCE_TICK_MS = 30_000;
const BIRTHDAY_TICK_MS = 5 * 60_000;
const SLA_TICK_MS = 60_000;
const IDLE_TICK_MS = 5 * 60_000;
const VOICE_XP_TICK_MS = 60_000;
const ACTIVITY_TICK_MS = 60_000;
const ACTIVITY_ROLES_TICK_MS = 24 * 60 * 60_000;
const BACKUP_TICK_MS = 24 * 60 * 60_000;
const APPEAL_SLA_TICK_MS = 60 * 60_000; // hourly

export function startScheduler(client: Client): void {
  setInterval(() => fireDueReminders(client).catch(noop), REMINDER_TICK_MS);
  setInterval(() => closeDuePolls(client).catch(noop), POLL_TICK_MS);
  setInterval(() => deliverPendingPosts(client).catch(noop), POSTS_TICK_MS);
  setInterval(() => pollRssFeeds().catch(noop), RSS_TICK_MS);
  setInterval(() => pollTwitchStreams().catch(noop), TWITCH_TICK_MS);
  setInterval(() => fireDueAnnouncements().catch(noop), ANNOUNCE_TICK_MS);
  setInterval(() => fireBirthdays(client).catch(noop), BIRTHDAY_TICK_MS);
  setInterval(() => sweepSlaReminders(client).catch(noop), SLA_TICK_MS);
  setInterval(() => sweepIdleTickets(client).catch(noop), IDLE_TICK_MS);
  setInterval(() => awardActiveVoiceXp(client).catch(noop), VOICE_XP_TICK_MS);
  setInterval(() => {
    try {
      tickVoiceMinutes(client);
    } catch (err) {
      log.warn('tickVoiceMinutes error', { err: String(err) });
    }
    activityBatcher.flushAll().catch(noop);
  }, ACTIVITY_TICK_MS);
  setInterval(() => sweepActivityRoles(client).catch(noop), ACTIVITY_ROLES_TICK_MS);
  setInterval(() => runDailySnapshots().catch(noop), BACKUP_TICK_MS);
  setInterval(() => sweepStaleAppeals(client).catch(noop), APPEAL_SLA_TICK_MS);
  setTimeout(() => {
    fireDueReminders(client).catch(noop);
    closeDuePolls(client).catch(noop);
    deliverPendingPosts(client).catch(noop);
    pollRssFeeds().catch(noop);
    pollTwitchStreams().catch(noop);
    fireDueAnnouncements().catch(noop);
    fireBirthdays(client).catch(noop);
    sweepSlaReminders(client).catch(noop);
    sweepIdleTickets(client).catch(noop);
    sweepActivityRoles(client).catch(noop);
    runDailySnapshots().catch(noop);
    sweepStaleAppeals(client).catch(noop);
  }, 5_000);
}

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
