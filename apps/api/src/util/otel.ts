/**
 * Optional OpenTelemetry NodeSDK bootstrap.
 *
 * Activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. The @opentelemetry
 * packages are dynamic-imported in a try/catch so the API still builds and
 * boots when they aren't installed — observability is best-effort and never
 * fatal.
 *
 * Call once, before Fastify is constructed, so HTTP/Prisma auto-instrumentation
 * can hook into the runtime.
 */

let started = false;

export async function initOtel(): Promise<void> {
  if (started) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  // Use a dynamic helper so TS doesn't try to resolve the package types at
  // build time. The packages are optional — missing them is a no-op.
  const tryImport = async <T>(spec: string): Promise<T | null> => {
    try {
      const dyn = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
      return (await dyn(spec)) as T;
    } catch {
      return null;
    }
  };

  try {
    const sdkNode = await tryImport<{
      NodeSDK: new (config: Record<string, unknown>) => {
        start: () => void;
        shutdown: () => Promise<void>;
      };
    }>('@opentelemetry/sdk-node');
    if (!sdkNode) {
      console.log('[otel] @opentelemetry/sdk-node not installed; tracing disabled.');
      return;
    }

    const traceExporterMod = await tryImport<{
      OTLPTraceExporter: new (config: { url: string }) => unknown;
    }>('@opentelemetry/exporter-trace-otlp-http');
    const autoMod = await tryImport<{ getNodeAutoInstrumentations: () => unknown[] }>(
      '@opentelemetry/auto-instrumentations-node',
    );

    const config: Record<string, unknown> = {
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'discord-bot-api',
    };
    if (traceExporterMod) {
      config.traceExporter = new traceExporterMod.OTLPTraceExporter({
        url: endpoint.replace(/\/?$/, '') + '/v1/traces',
      });
    }
    if (autoMod) {
      config.instrumentations = autoMod.getNodeAutoInstrumentations();
    }

    const sdk = new sdkNode.NodeSDK(config);
    sdk.start();
    started = true;
    console.log(`[otel] tracing started → ${endpoint}`);

    const shutdown = (): void => {
      sdk.shutdown().catch(() => undefined);
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (err) {
    console.log('[otel] init failed; continuing without tracing:', (err as Error).message);
  }
}
