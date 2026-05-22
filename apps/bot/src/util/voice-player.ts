import type { Guild } from 'discord.js';
import { log } from '../logger.js';

// `@discordjs/voice` is an optional runtime dependency for this milestone:
// the package isn't listed in apps/bot/package.json, so we keep all
// references to it behind an untyped dynamic import and fall back to a
// "voice deps not installed" reply when it can't be resolved. The shape
// below covers only the members we actually call.
interface VoiceModule {
  joinVoiceChannel: (options: {
    channelId: string;
    guildId: string;
    adapterCreator: unknown;
    selfDeaf?: boolean;
    selfMute?: boolean;
  }) => VoiceConnection;
  createAudioResource: (input: string) => unknown;
  createAudioPlayer: () => AudioPlayer;
  entersState: (target: unknown, status: string, timeoutMs: number) => Promise<unknown>;
  getVoiceConnection: (guildId: string) => VoiceConnection | undefined;
  VoiceConnectionStatus: { Ready: string };
  AudioPlayerStatus: { Playing: string; Idle: string };
}

interface VoiceConnection {
  subscribe: (player: AudioPlayer) => unknown;
  destroy: () => void;
}

interface AudioPlayer {
  play: (resource: unknown) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => unknown;
}

// Module-level cache so we only fail the dynamic import once. Subsequent
// callers short-circuit instead of paying the resolution cost again.
let voiceModule: VoiceModule | null = null;
let voiceModuleResolved = false;

/**
 * Result of a playback attempt. `played: false` with a reason means voice
 * dependencies aren't installed or the call could not be completed; callers
 * are expected to surface this to the user.
 */
export interface PlayResult {
  played: boolean;
  reason?: string;
}

async function loadVoice(): Promise<VoiceModule | null> {
  if (voiceModuleResolved) return voiceModule;
  voiceModuleResolved = true;
  try {
    // String-built specifier prevents TypeScript from trying to resolve the
    // optional package at type-check time — see header comment.
    const moduleName = '@discordjs/voice';
    const mod = (await import(moduleName)) as unknown as VoiceModule;
    voiceModule = mod;
  } catch (err) {
    log.warn('@discordjs/voice not available — audio playback disabled', {
      err: String(err),
    });
    voiceModule = null;
  }
  return voiceModule;
}

/**
 * Connect to the given voice channel and play `audioUrl`. The returned promise
 * resolves once playback finishes (or never started). Failures are caught and
 * returned, not thrown — voice features are best-effort.
 */
export async function connectAndPlay(
  guild: Guild,
  channelId: string,
  audioUrl: string,
): Promise<PlayResult> {
  const voice = await loadVoice();
  if (!voice) {
    return { played: false, reason: 'voice deps not installed' };
  }

  let connection: VoiceConnection | null = null;
  try {
    connection = voice.joinVoiceChannel({
      channelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 15_000);

    const resource = voice.createAudioResource(audioUrl);
    const player = voice.createAudioPlayer();
    connection.subscribe(player);
    player.play(resource);

    await voice.entersState(player, voice.AudioPlayerStatus.Playing, 10_000);
    await new Promise<void>((resolve) => {
      player.on(voice.AudioPlayerStatus.Idle, () => resolve());
      player.on('error', () => resolve());
    });

    return { played: true };
  } catch (err) {
    log.warn('Voice playback failed', { guildId: guild.id, channelId, err: String(err) });
    return { played: false, reason: 'playback failed' };
  } finally {
    if (connection) {
      try {
        connection.destroy();
      } catch {
        // Already destroyed — ignore.
      }
    }
  }
}

/**
 * Disconnect the bot from voice in `guildId`, if connected. Returns true on
 * disconnect, false when not connected, and null when voice deps aren't
 * available.
 */
export async function disconnect(guildId: string): Promise<boolean | null> {
  const voice = await loadVoice();
  if (!voice) return null;
  const connection = voice.getVoiceConnection(guildId);
  if (!connection) return false;
  connection.destroy();
  return true;
}
