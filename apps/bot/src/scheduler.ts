import {
  ChannelType,
  EmbedBuilder,
  type APIEmbed,
  type Client,
  type TextChannel,
} from 'discord.js';
import { api, ApiError } from './api-client.js';
import { log } from './logger.js';
import { pollMessagePayload } from './util/poll-render.js';
import { fetchFeed } from './integrations/rss.js';
import { fetchStream } from './integrations/twitch.js';

const REMINDER_TICK_MS = 10_000;
const POLL_TICK_MS = 30_000;
const POSTS_TICK_MS = 15_000;
const RSS_TICK_MS = 60_000;
const TWITCH_TICK_MS = 60_000;
const ANNOUNCE_TICK_MS = 30_000;
const BIRTHDAY_TICK_MS = 5 * 60_000;

export function startScheduler(client: Client): void {
  setInterval(() => fireDueReminders(client).catch(noop), REMINDER_TICK_MS);
  setInterval(() => closeDuePolls(client).catch(noop), POLL_TICK_MS);
  setInterval(() => deliverPendingPosts(client).catch(noop), POSTS_TICK_MS);
  setInterval(() => pollRssFeeds().catch(noop), RSS_TICK_MS);
  setInterval(() => pollTwitchStreams().catch(noop), TWITCH_TICK_MS);
  setInterval(() => fireDueAnnouncements().catch(noop), ANNOUNCE_TICK_MS);
  setInterval(() => fireBirthdays(client).catch(noop), BIRTHDAY_TICK_MS);
  setTimeout(() => {
    fireDueReminders(client).catch(noop);
    closeDuePolls(client).catch(noop);
    deliverPendingPosts(client).catch(noop);
    pollRssFeeds().catch(noop);
    pollTwitchStreams().catch(noop);
    fireDueAnnouncements().catch(noop);
    fireBirthdays(client).catch(noop);
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
            await (channel as TextChannel).send({ content: lines, allowedMentions: { users: [r.userId] } });
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
    if (err instanceof ApiError) log.warn('dueTwitchIntegrations API error', { status: err.status });
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
            url: stream.thumbnail_url
              .replace('{width}', '640')
              .replace('{height}', '360'),
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
