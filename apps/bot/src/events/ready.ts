import { ActivityType, Events, type Client } from 'discord.js';
import { log } from '../logger.js';
import { api } from '../api-client.js';
import { ApiError } from '../api-client.js';
import { syncCustomCommands } from '../util/custom-commands-sync.js';
import { getCommandRegistry } from '../commands/registry.js';

const ROTATION_INTERVAL_MS = 30_000;

interface RotationTemplate {
  type: ActivityType;
  /** Render produces the live activity name; called every tick. */
  render(client: Client): string;
}

const TEMPLATES: RotationTemplate[] = [
  {
    type: ActivityType.Watching,
    render: (c) => `${c.guilds.cache.size} servers`,
  },
  {
    type: ActivityType.Playing,
    render: () => '/help',
  },
  {
    type: ActivityType.Listening,
    render: (c) => {
      // memberCount is per-guild; sum across cached guilds for a global figure.
      let total = 0;
      for (const g of c.guilds.cache.values()) total += g.memberCount;
      return `${total} members`;
    },
  },
  {
    type: ActivityType.Watching,
    render: () => `${getCommandRegistry().entries.length} commands`,
  },
];

/**
 * Drive a 30-second presence rotation cycling through the four templates.
 * Exported for tests; in production it's started from registerReady.
 */
export function startActivityRotation(client: Client): NodeJS.Timeout {
  let index = 0;
  const apply = () => {
    if (!client.user) return;
    const template = TEMPLATES[index % TEMPLATES.length]!;
    const name = template.render(client);
    try {
      client.user.setPresence({
        activities: [{ name, type: template.type }],
        status: 'online',
      });
    } catch (err) {
      log.warn('Failed to set presence', { err: String(err) });
    }
    index += 1;
  };
  apply();
  return setInterval(apply, ROTATION_INTERVAL_MS);
}

export function registerReady(client: Client): void {
  client.once(Events.ClientReady, async (ready) => {
    log.info('Bot ready', {
      user: ready.user.tag,
      guildCount: ready.guilds.cache.size,
    });

    // Kick off the rotating presence loop. It runs for the lifetime of the
    // process; we don't track the timer because client teardown ends the
    // process anyway.
    startActivityRotation(client);

    // Sync guild registry with the API so the dashboard knows which guilds the bot is in.
    for (const guild of ready.guilds.cache.values()) {
      try {
        await api.upsertGuild(guild.id, {
          name: guild.name,
          iconUrl: guild.iconURL({ size: 256 }),
        });
        // Re-register the guild's custom slash commands so they survive bot
        // restarts and reconcile any drift.
        await syncCustomCommands(guild.id).catch(() => {});
      } catch (err) {
        if (err instanceof ApiError) {
          log.warn('Failed to sync guild on ready', {
            guildId: guild.id,
            status: err.status,
            code: err.code,
          });
        } else {
          log.error('Unexpected error syncing guild', { guildId: guild.id, err: String(err) });
        }
      }
    }
  });
}
