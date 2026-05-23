import {
  Events,
  type Client,
  type Message,
  type MessageReaction,
  type PartialMessage,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import {
  bumpLocalActivity,
  evaluateOnEventBackground,
} from '../util/achievement-eval.js';

// In-process per-(guild, user) counters for reactions and sticker uses.
// Authoritative cumulative totals don't live anywhere yet — these are
// best-effort and reset on restart. Threshold-1 unlocks ("first reaction")
// still fire reliably since one event is enough.
const reactionCounters = new Map<string, number>();
const stickerCounters = new Map<string, number>();

function counterKey(guildId: string, userId: string): string {
  return `${guildId}|${userId}`;
}

function bumpCounter(map: Map<string, number>, guildId: string, userId: string, by = 1): number {
  const k = counterKey(guildId, userId);
  const next = (map.get(k) ?? 0) + by;
  map.set(k, next);
  return next;
}

export function registerAchievementEvents(client: Client): void {
  // ─── Messages — fan-out to the evaluator on each non-bot message ─────
  // Bump the local delta first so the evaluator's cumulative-resolve picks
  // up this very message even before the activity flusher runs (~60s cadence).
  client.on(Events.MessageCreate, (message: Message | PartialMessage) => {
    if (!message.inGuild() || !message.guildId) return;
    if (message.author?.bot ?? true) return;
    const guildId = message.guildId;
    const userId = message.author!.id;
    bumpLocalActivity(guildId, userId, { messages: 1 });
    evaluateOnEventBackground(client, 'messages', guildId, userId, undefined, message.channelId);

    // Stickers ride along on the same message. discord.js exposes them as a
    // collection of `Sticker` instances on the message.
    if (message.stickers && message.stickers.size > 0) {
      const next = bumpCounter(stickerCounters, guildId, userId, message.stickers.size);
      evaluateOnEventBackground(client, 'stickers', guildId, userId, next, message.channelId);
    }
  });

  // ─── Reactions — only the *add* side counts toward the user. ─────────
  client.on(
    Events.MessageReactionAdd,
    (
      reaction: MessageReaction | PartialMessageReaction,
      user: User | PartialUser,
    ) => {
      if (user.bot) return;
      const guildId = reaction.message.guildId;
      if (!guildId) return;
      const next = bumpCounter(reactionCounters, guildId, user.id);
      const channelId = reaction.message.channelId;
      evaluateOnEventBackground(
        client,
        'reactions',
        guildId,
        user.id,
        next,
        channelId ?? undefined,
      );
    },
  );
}
