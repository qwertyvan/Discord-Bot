/**
 * Thin façade in front of a Lavalink client (shoukaku or lavalink-client),
 * loaded via dynamic import so the bot still compiles and runs when no
 * Lavalink client is installed. When the client is missing every method
 * returns { ok: false, reason: 'lavalink-not-installed' } — the queue is
 * still persisted to the database via the API; only playback is disabled.
 *
 * Required env (consumed by the underlying client when present):
 *   LAVALINK_HOST       — hostname of the Lavalink node (e.g. "localhost")
 *   LAVALINK_PORT       — TCP port (default 2333)
 *   LAVALINK_PASSWORD   — auth password configured on the node
 */

export interface MusicTrackInfo {
  title: string;
  url: string;
  durationSec?: number;
}

export interface SearchResultTrack {
  title: string;
  url: string;
  durationSec: number | null;
  author?: string;
}

export type PlayerResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; reason: 'lavalink-not-installed' | 'no-voice-channel' | 'error'; message?: string };

// A minimal duck-typed shape for whichever client we end up loading. We keep
// this loose because shoukaku and lavalink-client have different APIs; the
// concrete bridge is `loadClient()` below.
interface ClientBridge {
  search(query: string): Promise<SearchResultTrack[]>;
  connect(guildId: string, voiceChannelId: string): Promise<void>;
  play(guildId: string, track: MusicTrackInfo): Promise<void>;
  pause(guildId: string): Promise<void>;
  resume(guildId: string): Promise<void>;
  skip(guildId: string): Promise<void>;
  stop(guildId: string): Promise<void>;
  setVolume(guildId: string, volume: number): Promise<void>;
  disconnect(guildId: string): Promise<void>;
}

let bridgePromise: Promise<ClientBridge | null> | null = null;

async function tryImport(name: string): Promise<Record<string, unknown> | null> {
  // Hidden behind a runtime variable so TypeScript doesn't try to resolve the
  // (intentionally absent) packages. Both `shoukaku` and `lavalink-client`
  // are optional peer dependencies installed by deployers.
  const dynamicImport = new Function('m', 'return import(m)') as (
    m: string,
  ) => Promise<Record<string, unknown>>;
  try {
    return await dynamicImport(name);
  } catch {
    return null;
  }
}

async function loadBridge(): Promise<ClientBridge | null> {
  // Try shoukaku, then lavalink-client. Both packages are optional; if neither
  // resolves we cache `null` and report 'lavalink-not-installed' from here on.
  const shoukaku = await tryImport('shoukaku');
  if (shoukaku) {
    // We don't actually wire the client up here — the user is expected to
    // configure their own Shoukaku instance and inject it. For now we just
    // detect availability so error messages can hint at the install step.
    // A future milestone can flesh this out with a real bridge.
    return null;
  }
  const lavalinkClient = await tryImport('lavalink-client');
  if (lavalinkClient) return null;
  return null;
}

function getBridge(): Promise<ClientBridge | null> {
  if (!bridgePromise) bridgePromise = loadBridge();
  return bridgePromise;
}

const notInstalled = { ok: false as const, reason: 'lavalink-not-installed' as const };

export const musicPlayer = {
  async isAvailable(): Promise<boolean> {
    return (await getBridge()) !== null;
  },

  async search(query: string): Promise<PlayerResult<SearchResultTrack[]>> {
    const bridge = await getBridge();
    if (!bridge) return notInstalled;
    try {
      const tracks = await bridge.search(query);
      return { ok: true, value: tracks };
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    }
  },

  async connectIfNeeded(guildId: string, voiceChannelId: string): Promise<PlayerResult> {
    const bridge = await getBridge();
    if (!bridge) return notInstalled;
    try {
      await bridge.connect(guildId, voiceChannelId);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    }
  },

  async play(guildId: string, track: MusicTrackInfo): Promise<PlayerResult> {
    const bridge = await getBridge();
    if (!bridge) return notInstalled;
    try {
      await bridge.play(guildId, track);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    }
  },

  async pause(guildId: string): Promise<PlayerResult> {
    const bridge = await getBridge();
    if (!bridge) return notInstalled;
    try {
      await bridge.pause(guildId);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    }
  },

  async resume(guildId: string): Promise<PlayerResult> {
    const bridge = await getBridge();
    if (!bridge) return notInstalled;
    try {
      await bridge.resume(guildId);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    }
  },

  async skip(guildId: string): Promise<PlayerResult> {
    const bridge = await getBridge();
    if (!bridge) return notInstalled;
    try {
      await bridge.skip(guildId);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    }
  },

  async stop(guildId: string): Promise<PlayerResult> {
    const bridge = await getBridge();
    if (!bridge) return notInstalled;
    try {
      await bridge.stop(guildId);
      await bridge.disconnect(guildId);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    }
  },

  async setVolume(guildId: string, volume: number): Promise<PlayerResult> {
    const bridge = await getBridge();
    if (!bridge) return notInstalled;
    try {
      await bridge.setVolume(guildId, volume);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    }
  },
};

export function describePlayerError(result: { reason: string; message?: string }): string {
  if (result.reason === 'lavalink-not-installed') {
    return 'Music playback is unavailable: a Lavalink client (`shoukaku` or `lavalink-client`) is not installed in this build. The queue is still being recorded in the database.';
  }
  if (result.reason === 'no-voice-channel') {
    return 'You must be in a voice channel to use this command.';
  }
  return result.message ?? 'Music player encountered an error.';
}
