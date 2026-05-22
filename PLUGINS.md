# Plugin System

Drop-in extension points for the bot. Plugins are JavaScript files executed in
a sandboxed `node:vm` context with a manifest-declared permission model. The
bot scans `plugins/*` on `ready` and registers any plugin whose manifest
parses successfully.

## Layout

Each plugin lives in its own directory under the repo-root `plugins/` folder:

```
plugins/
  my-plugin/
    plugin.json
    index.js
```

`index.js` may be hand-written JS or the compiled output of a TypeScript
source. The loader does not execute TypeScript directly — pre-compile before
shipping.

## `plugin.json` manifest

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Optional human-readable summary.",
  "author": "Optional author string.",
  "hooks": {
    "onMessage": true,
    "onCommand": true,
    "onMemberJoin": true
  },
  "permissions": ["network"]
}
```

Field reference:

- `name` (required) — alphanumeric, dashes, underscores. Used in log lines.
- `version` (required) — free-form semver-ish string.
- `description`, `author` — optional metadata.
- `hooks` — opt-in flags for the dispatcher. Only hooks listed here AND
  exported by `index.js` are invoked. Currently supported: `onMessage`,
  `onCommand`, `onMemberJoin`.
- `permissions` — capability shims to inject:
  - `network` — exposes the global `fetch`. Without this permission, plugins
    cannot make HTTP calls.
  - `fs` — reserved; no shim is provided yet, so this is a no-op.

## Hook signatures

All payloads are plain, deep-frozen JSON objects. The live `discord.js`
objects (which carry a reference to the bot token) are **never** handed to
plugins.

```js
// onMessage
function onMessage({
  id,                  // message ID
  content,             // string
  authorId,            // user snowflake
  authorBot,           // boolean
  guildId,             // snowflake | null (DMs)
  channelId,           // snowflake
  createdTimestamp,    // number (ms)
}) { /* ... */ }

// onCommand — fired for every chat-input slash command
function onCommand({
  id,                  // interaction ID
  commandName,         // string
  userId,              // snowflake
  guildId,             // snowflake | null
  channelId,           // snowflake | null
  options,             // [{ name, type, value }] — strings/numbers/booleans only
}) { /* ... */ }

// onMemberJoin
function onMemberJoin({
  userId,              // snowflake
  username,            // string
  guildId,             // snowflake
  joinedTimestamp,     // number | null
}) { /* ... */ }
```

Hooks may be exported via `module.exports` (CommonJS-style) or declared as
top-level `function` names in `index.js`. Each invocation has a 500 ms hard
timeout enforced by the vm runtime.

## Sandbox globals

Inside the sandbox, plugins have:

- `console` — proxied to the bot's structured logger, prefixed with
  `[plugin:<name>]`.
- `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`.
- `module` and `exports` (CommonJS shim).
- `process.env` — empty frozen object. `process.platform` / `process.version`
  are exposed for compatibility but `process.env` never contains host secrets.
- `fetch` — only when `permissions` includes `"network"`.

Explicitly **not** provided: `require`, `import`, `fs`, `net`, `child_process`,
the bot token, or any live discord.js object.

## Failure semantics

- Manifest parse failures are logged and skip the plugin.
- A throw or timeout inside a hook is caught, logged at `warn`, and never
  propagates back into the host bot. Other plugins continue to fire.
- Plugins cannot crash the host — but a plugin tight loop that completes
  inside the 500 ms budget is still 500 ms of latency, so keep hooks fast.

## Operator commands

- `make plugins-list` — prints the plugin directories the bot will pick up.

See `plugins/hello-world/` for a working example.
