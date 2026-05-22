import { z } from 'zod';

/**
 * Plugin manifest schema (parsed from each plugin's `plugin.json`).
 *
 * Hooks are simple function names that the plugin's `index.js` is expected to
 * export on its module-level scope (the sandbox treats the plugin file as a
 * script, so the names are read off the sandbox global object after the script
 * runs).
 */
export const PluginHookNames = ['onMessage', 'onCommand', 'onMemberJoin'] as const;
export type PluginHookName = (typeof PluginHookNames)[number];

export const PluginPermissions = ['network', 'fs'] as const;
export type PluginPermission = (typeof PluginPermissions)[number];

export const PluginManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'name must be alphanumeric/dash/underscore'),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  /**
   * Whitelist of hook names this plugin wants the dispatcher to invoke. The
   * actual export presence is verified at load time.
   */
  hooks: z
    .object({
      onMessage: z.boolean().optional(),
      onCommand: z.boolean().optional(),
      onMemberJoin: z.boolean().optional(),
    })
    .default({}),
  /**
   * Capability shims to inject into the sandbox. Anything not listed is
   * stripped — most importantly, plugins without `network` do NOT receive
   * `fetch`, and no plugin ever sees `fs`, `process.env`, or `require`.
   */
  permissions: z.array(z.enum(PluginPermissions)).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
