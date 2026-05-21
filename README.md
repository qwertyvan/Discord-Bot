# Discord Bot

A production-style, open-source Discord bot built in TypeScript. Three pieces work together:

- **Bot** — `discord.js` v14 with slash commands for moderation, utility, and fun.
- **API** — Fastify 5 + Prisma 6 + Postgres. The single source of truth for persistent state.
- **Web** — Next.js 15 admin dashboard. Signs in with Discord OAuth2 and only shows servers where you have **Manage Server**.

The bot never touches the database directly — it calls the API with a shared bearer token. The web app talks to the API with a signed session cookie issued during OAuth callback.

## Architecture

```
┌──────────────────┐       ┌──────────────┐       ┌──────────────┐
│  Web (Admin UI)  │ ────▶ │     API      │ ◀──── │  Discord Bot │
│   Next.js 15     │       │   Fastify 5  │       │ discord.js 14│
└──────────────────┘       └──────┬───────┘       └──────────────┘
   Discord OAuth2                 │                Bot token + BOT_API_TOKEN
   Session cookie                 ▼
                            ┌──────────────┐
                            │  Postgres    │
                            │  + Prisma    │
                            └──────────────┘
```

## Features

| Category | Commands / capabilities |
|---|---|
| **General** | `/ping`, `/about`, `/help` |
| **Moderation** | `/warn`, `/warnings`, `/kick`, `/ban`, `/unban`, `/softban`, `/timeout`, `/mute`, `/unmute`, `/massban`, `/masskick`, `/note`, `/history`, `/case`, `/lockdown`, `/unlockdown`, `/slow`, `/purge` |
| **Utility** | `/userinfo`, `/serverinfo`, `/avatar`, `/roles` |
| **Fun** | `/8ball`, `/roll`, `/coinflip`, `/choose` |
| **Welcome events** | Configurable join/leave messages with `{user}` / `{username}` / `{server}` / `{memberCount}` placeholders |
| **Audit logging** | Configurable per-event logging of message edits/deletes, member joins/leaves, role changes, channel CRUD, and voice activity to a chosen channel and to a searchable database |
| **Warning policy** | Optional warning expiry (auto-deactivate after N days) and threshold-based auto-escalation (e.g. 3 warnings → 1h timeout, 5 → ban) |
| **Case-numbered mod log** | Every moderation action gets a unique per-guild case number for easy reference (`/case 42`) and a unified `/history @user` view |
| **Auto-moderation** | Per-guild rules for anti-spam, anti-invite, mass-mention, CAPS, emoji-spam, zalgo, link allow/block lists, badwords, phishing domains; per-join rules for new accounts and raid lockdown; configurable action (delete/warn/timeout/kick/ban) and exempt roles/channels |
| **Onboarding** | Join/leave + DM templates, auto-role on join, milestone announcements, button-based verification gate |
| **Reaction roles** | Self-serve role panels rendered as buttons (≤ 5 options) or a dropdown, with optional exclusive groups |
| **Polls** | `/poll create` with up to 10 options, anonymous mode, multi-select, optional auto-close |
| **Reminders** | `/remindme` personal reminders posted in-channel or DM'd, with `/reminders list`/`cancel` |
| **Tags** | `/tag add|edit|remove|list|show` canned-content snippets with usage counters |
| **Auto-responses** | Keyword → message auto-replies with contains/word/exact matching |
| **XP &amp; leveling** | Text + voice XP, per-channel multipliers, no-XP roles, level-up announcements, level-based role rewards, `/rank`, `/leaderboard`, admin `/level give\|reset` |
| **Economy** | Per-server currency, `/balance`, `/daily`, `/work`, `/pay`, `/shop add\|list\|buy\|remove`, `/inventory`, `/rich` leaderboard, optional `/gamble coinflip\|slots` |
| **Tickets** | Button-driven private support threads, optional categories with separate staff teams, `/ticket close\|assign`, dashboard list of open/closed tickets |
| **Stats &amp; analytics** | Stats dashboard tab with member growth (30d), mod-action trends (30d, stacked by type), top moderation targets, and a per-channel × hour activity heatmap |
| **Integrations** | RSS feed subscriptions (YouTube, Reddit, blogs) polled by the bot; incoming webhook endpoints with optional HMAC-SHA256 signing — payloads queued and delivered by the bot |
| **Admin dashboard** | Per-guild stats, filterable mod log, audit log, automod editor, welcome / verification / reaction-roles / logging / policy / leveling / economy / tickets / stats config screens |

## Project layout

```
.
├── apps/
│   ├── api/       Fastify + Prisma — the only thing that touches the DB
│   ├── bot/       discord.js — calls the API for persisted state
│   └── web/       Next.js admin dashboard
├── packages/
│   └── shared/    Zod schemas + TS types shared by all three apps
├── docker-compose.yml
└── package.json   (npm workspaces)
```

## Prerequisites

- Node.js **20+**
- Docker (for Postgres) — or any Postgres 14+ you already have
- A Discord application + bot token: https://discord.com/developers/applications

## Discord application setup

1. Create an application at <https://discord.com/developers/applications>.
2. In **Bot**:
   - Click **Reset Token** and save it as `DISCORD_TOKEN`.
   - Under **Privileged Gateway Intents**, enable **Server Members Intent** (required for welcome/leave events).
3. In **OAuth2 → Redirects**, add `http://localhost:4000/auth/discord/callback`.
4. Save the **Client ID** as `DISCORD_CLIENT_ID` and **Client Secret** as `DISCORD_CLIENT_SECRET`.

### Invite the bot to a test server

Use this URL (replace `<CLIENT_ID>`):

```
https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&permissions=1099780767302&scope=bot+applications.commands
```

The permission integer grants Kick/Ban/Timeout/Manage Messages/Send Messages/Embed Links/Read History/View Channels — adjust to taste.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env templates
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/bot/.env.example apps/bot/.env
cp apps/web/.env.example apps/web/.env

# 3. Generate two long random secrets, e.g.
openssl rand -hex 32   # → paste into BOT_API_TOKEN (same value in apps/api AND apps/bot)
openssl rand -hex 32   # → paste into SESSION_SECRET (apps/api)

# 4. Start Postgres
npm run db:up

# 5. Apply database migrations
npm run db:migrate

# 6. Register slash commands with Discord
#    Set DEV_GUILD_ID in apps/bot/.env to register instantly to one guild;
#    leave it blank for a global registration (can take up to ~1 hour).
npm run --workspace @discord-bot/bot deploy-commands
```

## Running

Run each app in its own terminal:

```bash
npm run dev:api
npm run dev:bot
npm run dev:web
```

- API: <http://localhost:4000> (health: `/health`, `/health/db`)
- Web: <http://localhost:3000>
- Bot: connects to the Discord gateway and to the API

## Environment variables

Each `.env.example` is the authoritative reference. The key cross-app ones:

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | api | Postgres connection string |
| `BOT_API_TOKEN` | api, bot | **Must match** — bot ↔ API service auth |
| `SESSION_SECRET` | api | Signs the session cookie. 32+ chars. |
| `DISCORD_CLIENT_ID` | api, bot | Application client id |
| `DISCORD_CLIENT_SECRET` | api | OAuth secret |
| `DISCORD_TOKEN` | bot | Bot token from the Bot tab |
| `WEB_ORIGIN` | api | Used for CORS + redirect after OAuth |
| `API_BASE_URL` | web | Server-to-server URL the Next.js server uses |
| `NEXT_PUBLIC_API_BASE_URL` | web | Browser-facing URL (used by the sign-in link) |

## Adding a new slash command

1. Create `apps/bot/src/commands/<group>/<name>.ts` exporting a `SlashCommand`.
2. Add it to the matching `apps/bot/src/commands/<group>/index.ts`.
3. Run `npm run --workspace @discord-bot/bot deploy-commands` to register it with Discord.

Persisted state (anything you want to read from the dashboard or survive restarts) goes through the API:

1. Add a Prisma model + `npm run db:migrate`.
2. Add a Zod schema in `packages/shared/src/`.
3. Add a route in `apps/api/src/routes/`.
4. Add a method in `apps/bot/src/api-client.ts`.

## Deployment notes

- Both `apps/api` and `apps/bot` are long-running Node processes. The API listens on `API_PORT`; the bot has no HTTP listener.
- `apps/web` is a standard Next.js app — deploy with `next start` or any Next-compatible platform.
- Set `NODE_ENV=production` to enable secure cookies (`secure: true`, `sameSite=lax`) and JSON-only logs.
- Use `npm run prisma:deploy --workspace @discord-bot/api` for production migrations.

## License

MIT — see [LICENSE](./LICENSE).
