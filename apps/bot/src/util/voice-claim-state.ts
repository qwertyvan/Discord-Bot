// In-memory grace-window timers for voice claims. When a claim's owner leaves
// the channel, the voice-state handler arms a 60-second timer here that, on
// fire, releases the claim via the API. If the owner returns to the same
// channel before the timer elapses, we cancel the pending release.
//
// Keyed by `${guildId}:${channelId}` so it's safe to track many guilds at once.
// State is process-local — if the bot restarts mid-grace the claim simply
// stays put until the channel empties (which also triggers a release).

const pendingRelease = new Map<string, NodeJS.Timeout>();

function key(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

/** Arm a one-shot release timer. Replaces any pending timer for the same key. */
export function schedulePendingRelease(
  guildId: string,
  channelId: string,
  delayMs: number,
  onFire: () => void | Promise<void>,
): void {
  cancelPendingRelease(guildId, channelId);
  const handle = setTimeout(() => {
    pendingRelease.delete(key(guildId, channelId));
    void onFire();
  }, delayMs);
  pendingRelease.set(key(guildId, channelId), handle);
}

/** Cancel any pending release timer. Returns true if one was cancelled. */
export function cancelPendingRelease(guildId: string, channelId: string): boolean {
  const k = key(guildId, channelId);
  const existing = pendingRelease.get(k);
  if (!existing) return false;
  clearTimeout(existing);
  pendingRelease.delete(k);
  return true;
}

export function hasPendingRelease(guildId: string, channelId: string): boolean {
  return pendingRelease.has(key(guildId, channelId));
}

// 60 seconds — matches the spec for the owner-absence grace window.
export const VOICE_CLAIM_GRACE_MS = 60_000;
