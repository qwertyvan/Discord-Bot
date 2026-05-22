import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { log } from '../logger.js';
import {
  PluginManifestSchema,
  type PluginManifest,
  type PluginHookName,
  PluginHookNames,
} from './manifest.js';

/**
 * A plugin loaded from disk. The sandbox is the live vm.Context the script was
 * run in — the dispatcher pulls hook functions off `sandbox.module.exports`
 * (CommonJS-ish) or the global `onMessage` / `onCommand` / `onMemberJoin`
 * bindings if the plugin chose top-level functions.
 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory. */
  dir: string;
  /** vm.Context the plugin runs inside. */
  context: vm.Context;
  /** Resolved hook callables, already bound to the sandbox context. */
  hooks: Partial<Record<PluginHookName, (payload: unknown) => unknown>>;
}

interface SandboxGlobals {
  console: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  module: { exports: Record<string, unknown> };
  exports: Record<string, unknown>;
  process: { env: Record<string, never>; platform: string; version: string };
  fetch?: typeof fetch;
}

/**
 * Module-level cache of loaded plugins. The bot calls `scanPluginsDir` on
 * `ready` and the dispatcher reads `getLoadedPlugins()` on every hook
 * invocation.
 */
let loaded: LoadedPlugin[] = [];

export function getLoadedPlugins(): readonly LoadedPlugin[] {
  return loaded;
}

/**
 * Scan `<rootPath>/*` for plugin folders, validate each `plugin.json`, and
 * boot the plugin's `index.js` inside a fresh vm context.
 *
 * Errors with a single plugin never abort the scan — they are logged and the
 * plugin is skipped. The returned array also replaces the module-level cache.
 */
export async function scanPluginsDir(rootPath: string = 'plugins'): Promise<LoadedPlugin[]> {
  const absRoot = resolve(rootPath);
  const next: LoadedPlugin[] = [];

  let entries: string[];
  try {
    entries = await readdir(absRoot);
  } catch (err) {
    // Missing plugins/ dir is fine — just means no plugins installed.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      log.info('Plugins directory not present — no plugins loaded', { root: absRoot });
      loaded = next;
      return next;
    }
    log.warn('Failed to read plugins root', { root: absRoot, err: String(err) });
    loaded = next;
    return next;
  }

  for (const entry of entries) {
    const pluginDir = join(absRoot, entry);
    try {
      const st = await stat(pluginDir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    const plugin = await loadOnePlugin(pluginDir);
    if (plugin) next.push(plugin);
  }

  loaded = next;
  log.info('Plugin scan complete', {
    count: next.length,
    names: next.map((p) => p.manifest.name),
  });
  return next;
}

async function loadOnePlugin(pluginDir: string): Promise<LoadedPlugin | null> {
  const manifestPath = join(pluginDir, 'plugin.json');
  let manifest: PluginManifest;
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const json = JSON.parse(raw) as unknown;
    manifest = PluginManifestSchema.parse(json);
  } catch (err) {
    log.warn('Plugin manifest invalid — skipping', { dir: pluginDir, err: String(err) });
    return null;
  }

  // Locate entrypoint. `.js` is the canonical form (TS plugins must compile to
  // JS before being dropped into the plugins dir).
  const entryJs = join(pluginDir, 'index.js');
  let source: string;
  try {
    source = await readFile(entryJs, 'utf8');
  } catch (err) {
    log.warn('Plugin entrypoint missing — skipping', { dir: pluginDir, err: String(err) });
    return null;
  }

  const sandbox = buildSandbox(manifest);
  const context = vm.createContext(sandbox, { name: `plugin:${manifest.name}` });

  try {
    const script = new vm.Script(source, { filename: entryJs });
    script.runInContext(context, { timeout: 1000 });
  } catch (err) {
    log.warn('Plugin failed to initialize — skipping', {
      name: manifest.name,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const hooks = resolveHooks(manifest, sandbox);

  // If the manifest claims hooks but none of them resolve, the plugin is
  // effectively inert. Still load it so the operator sees the warning.
  for (const name of PluginHookNames) {
    if (manifest.hooks[name] && !hooks[name]) {
      log.warn('Plugin declares hook but did not export it', {
        plugin: manifest.name,
        hook: name,
      });
    }
  }

  log.info('Plugin loaded', {
    name: manifest.name,
    version: manifest.version,
    permissions: manifest.permissions,
    hooks: Object.keys(hooks),
  });

  return { manifest, dir: pluginDir, context, hooks };
}

function buildSandbox(manifest: PluginManifest): SandboxGlobals {
  const tag = `[plugin:${manifest.name}]`;

  // Proxied console so plugin output ends up in the bot's structured logger.
  const pluginConsole = {
    log: (...args: unknown[]) => log.info(`${tag} ${args.map(String).join(' ')}`),
    info: (...args: unknown[]) => log.info(`${tag} ${args.map(String).join(' ')}`),
    warn: (...args: unknown[]) => log.warn(`${tag} ${args.map(String).join(' ')}`),
    error: (...args: unknown[]) => log.error(`${tag} ${args.map(String).join(' ')}`),
    debug: (...args: unknown[]) => log.debug(`${tag} ${args.map(String).join(' ')}`),
  } satisfies SandboxGlobals['console'];

  const moduleObj = { exports: {} as Record<string, unknown> };
  const sandbox: SandboxGlobals = {
    console: pluginConsole,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    module: moduleObj,
    exports: moduleObj.exports,
    process: {
      // Plugins never see the host's env. We expose an empty object so plugins
      // that read process.env don't crash but get nothing exfiltratable.
      env: Object.freeze({}) as Record<string, never>,
      platform: process.platform,
      version: process.version,
    },
  };

  if (manifest.permissions.includes('network')) {
    // Provide `fetch` only when the manifest opts in. We don't proxy it
    // further — outbound HTTP is up to the operator to firewall.
    sandbox.fetch = fetch.bind(globalThis);
  }

  // `fs` capability has no in-process shim yet (Node's fs module isn't safe to
  // hand to untrusted code). Reserved for future use; declaring it is a no-op.

  return sandbox;
}

function resolveHooks(
  manifest: PluginManifest,
  sandbox: SandboxGlobals,
): LoadedPlugin['hooks'] {
  const hooks: LoadedPlugin['hooks'] = {};
  const exportsObj = (sandbox.module.exports ?? {}) as Record<string, unknown>;
  const globalScope = sandbox as unknown as Record<string, unknown>;

  for (const name of PluginHookNames) {
    if (!manifest.hooks[name]) continue;
    const fromExports = exportsObj[name];
    const fromGlobal = globalScope[name];
    const fn = typeof fromExports === 'function' ? fromExports : fromGlobal;
    if (typeof fn === 'function') {
      hooks[name] = fn as (payload: unknown) => unknown;
    }
  }
  return hooks;
}
