import { ChannelType, type Client, type TextChannel } from 'discord.js';
import { api, ApiError } from './api-client.js';
import { log } from './logger.js';
import { pollMessagePayload } from './util/poll-render.js';

const REMINDER_TICK_MS = 10_000;
const POLL_TICK_MS = 30_000;

/**
 * Lightweight polling-based scheduler. The API exposes /reminders/due and
 * /polls/due so the bot can pull both. A real production deployment would
 * probably move this onto a job queue (BullMQ, Temporal), but for the
 * single-process bot a 10s/30s tick is fine.
 */
export function startScheduler(client: Client): void {
  setInterval(() => fireDueReminders(client).catch(noop), REMINDER_TICK_MS);
  setInterval(() => closeDuePolls(client).catch(noop), POLL_TICK_MS);
  // Run once shortly after startup so we don't make users wait a full tick.
  setTimeout(() => {
    fireDueReminders(client).catch(noop);
    closeDuePolls(client).catch(noop);
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
