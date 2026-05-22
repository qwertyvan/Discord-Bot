/**
 * Per-guild in-memory bookkeeping for the anti-raid event handler:
 *   - a ring buffer of recent join timestamps so we can compute joinsPerMinute
 *   - the id (+ blocked-counter) of the active lockdown LockdownEvent, if any
 *   - the wall-clock time the lockdown is scheduled to expire
 *
 * Lives in-process and resets on bot restart, which is fine — raid bursts
 * resolve within minutes and the API is the source of truth for LockdownEvent
 * rows.
 */
const JOIN_WINDOW_MS = 60_000;
const MAX_JOINS_TRACKED = 200;

interface GuildState {
  joinTimestamps: number[];
  lockdown: ActiveLockdown | null;
}

export interface ActiveLockdown {
  id: string;
  guildId: string;
  expiresAt: number;
  blocked: number;
}

const state = new Map<string, GuildState>();

function ensure(guildId: string): GuildState {
  let s = state.get(guildId);
  if (!s) {
    s = { joinTimestamps: [], lockdown: null };
    state.set(guildId, s);
  }
  return s;
}

export function recordJoin(guildId: string, at = Date.now()): number {
  const s = ensure(guildId);
  s.joinTimestamps.push(at);
  if (s.joinTimestamps.length > MAX_JOINS_TRACKED) {
    s.joinTimestamps.splice(0, s.joinTimestamps.length - MAX_JOINS_TRACKED);
  }
  return joinsPerMinute(guildId, at);
}

export function joinsPerMinute(guildId: string, now = Date.now()): number {
  const s = state.get(guildId);
  if (!s) return 0;
  const cutoff = now - JOIN_WINDOW_MS;
  // Trim stale entries.
  while (s.joinTimestamps.length > 0 && s.joinTimestamps[0]! < cutoff) {
    s.joinTimestamps.shift();
  }
  return s.joinTimestamps.length;
}

export function getActiveLockdown(guildId: string): ActiveLockdown | null {
  const s = state.get(guildId);
  if (!s?.lockdown) return null;
  if (s.lockdown.expiresAt <= Date.now()) {
    // Caller is responsible for clearing via clearLockdown after persisting.
    return s.lockdown;
  }
  return s.lockdown;
}

export function setActiveLockdown(lockdown: ActiveLockdown): void {
  const s = ensure(lockdown.guildId);
  s.lockdown = lockdown;
}

export function bumpBlocked(guildId: string): number {
  const s = state.get(guildId);
  if (!s?.lockdown) return 0;
  s.lockdown.blocked += 1;
  return s.lockdown.blocked;
}

export function clearLockdown(guildId: string): ActiveLockdown | null {
  const s = state.get(guildId);
  if (!s) return null;
  const prev = s.lockdown;
  s.lockdown = null;
  return prev;
}

export function listActiveLockdowns(): ActiveLockdown[] {
  const result: ActiveLockdown[] = [];
  for (const s of state.values()) {
    if (s.lockdown) result.push(s.lockdown);
  }
  return result;
}
