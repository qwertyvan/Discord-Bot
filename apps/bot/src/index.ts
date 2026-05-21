import { env } from './env.js';
import { createClient } from './client.js';
import { log } from './logger.js';

async function main(): Promise<void> {
  const client = createClient();

  const shutdown = async (signal: NodeJS.Signals) => {
    log.info('Shutting down', { signal });
    await client.destroy();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => {
  log.error('Fatal error during startup', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
