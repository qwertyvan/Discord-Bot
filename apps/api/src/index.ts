import { initOtel } from './util/otel.js';
import { buildApp } from './app.js';
import { startWebhookWorker } from './workers/webhook-worker.js';

async function main(): Promise<void> {
  // Best-effort: starts the OpenTelemetry NodeSDK when OTEL_EXPORTER_OTLP_ENDPOINT
  // is set and the @opentelemetry packages are available. No-op otherwise.
  await initOtel();

  const app = await buildApp();
  try {
    await app.listen({ host: app.config.API_HOST, port: app.config.API_PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const stopWebhookWorker = startWebhookWorker(app);

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'Shutting down');
    stopWebhookWorker();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
