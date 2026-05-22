import vm from 'node:vm';
import type {
  ChatInputCommandInteraction,
  GuildMember,
  Message,
} from 'discord.js';
import { log } from '../logger.js';
import { getLoadedPlugins, type LoadedPlugin } from './loader.js';
import type { PluginHookName } from './manifest.js';

/**
 * Plain-JSON payloads handed to plugins. Crucially these are *not* live
 * discord.js objects — those carry a `.client.token` reference that would
 * leak the bot token into plugin sandboxes.
 */
export interface MessagePayload {
  id: string;
  content: string;
  authorId: string;
  authorBot: boolean;
  guildId: string | null;
  channelId: string;
  createdTimestamp: number;
}

export interface CommandPayload {
  id: string;
  commandName: string;
  userId: string;
  guildId: string | null;
  channelId: string | null;
  options: { name: string; type: number; value: string | number | boolean | null }[];
}

export interface MemberJoinPayload {
  userId: string;
  username: string;
  guildId: string;
  joinedTimestamp: number | null;
}

const HOOK_TIMEOUT_MS = 500;

export function dispatchOnMessage(message: Message): void {
  const payload: MessagePayload = {
    id: message.id,
    content: message.content,
    authorId: message.author.id,
    authorBot: message.author.bot,
    guildId: message.guildId,
    channelId: message.channelId,
    createdTimestamp: message.createdTimestamp,
  };
  fanout('onMessage', payload);
}

export function dispatchOnCommand(interaction: ChatInputCommandInteraction): void {
  const options = interaction.options.data.map((opt) => ({
    name: opt.name,
    type: opt.type,
    value:
      typeof opt.value === 'string' || typeof opt.value === 'number' || typeof opt.value === 'boolean'
        ? opt.value
        : null,
  }));
  const payload: CommandPayload = {
    id: interaction.id,
    commandName: interaction.commandName,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    options,
  };
  fanout('onCommand', payload);
}

export function dispatchOnMemberJoin(member: GuildMember): void {
  const payload: MemberJoinPayload = {
    userId: member.id,
    username: member.user.username,
    guildId: member.guild.id,
    joinedTimestamp: member.joinedTimestamp,
  };
  fanout('onMemberJoin', payload);
}

function fanout(hookName: PluginHookName, payload: unknown): void {
  const plugins = getLoadedPlugins();
  if (plugins.length === 0) return;

  // Freeze the payload so plugins can't tamper with it and have that tamper
  // observed by later plugins (or by us, after the call returns).
  const frozen = deepFreeze(payload);

  for (const plugin of plugins) {
    invokePluginHook(plugin, hookName, frozen);
  }
}

function invokePluginHook(plugin: LoadedPlugin, hookName: PluginHookName, payload: unknown): void {
  const fn = plugin.hooks[hookName];
  if (!fn) return;

  try {
    // Run the call inside the plugin's vm context with a hard timeout so a
    // misbehaving plugin can't pin the event loop. We use `runInContext` on a
    // tiny trampoline rather than calling the function directly so the
    // timeout actually applies.
    const trampoline = new vm.Script(
      `(__pluginHookFn(__pluginHookArg));`,
      { filename: `plugin:${plugin.manifest.name}:${hookName}` },
    );
    const ctx = plugin.context as Record<string, unknown>;
    ctx['__pluginHookFn'] = fn;
    ctx['__pluginHookArg'] = payload;
    try {
      trampoline.runInContext(plugin.context, { timeout: HOOK_TIMEOUT_MS });
    } finally {
      delete ctx['__pluginHookFn'];
      delete ctx['__pluginHookArg'];
    }
  } catch (err) {
    log.warn('Plugin hook threw — host unaffected', {
      plugin: plugin.manifest.name,
      hook: hookName,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    const v = (value as Record<string, unknown>)[key];
    if (v && typeof v === 'object') deepFreeze(v);
  }
  return Object.freeze(value);
}
