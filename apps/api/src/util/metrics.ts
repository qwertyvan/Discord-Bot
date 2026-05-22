/**
 * Lightweight Prometheus-text-format metrics registry — no external library.
 *
 * Two metric kinds: Counter (monotonically increasing) and Gauge (settable).
 * Label sets are flattened to a stable key (`name|k1=v1,k2=v2`) so increments
 * to the same {name, labels} pair accumulate. Default metrics (resident memory,
 * uptime) are sampled on each `formatMetrics()` call.
 */

export type Labels = Record<string, string | number>;

interface Series {
  labels: Labels;
  value: number;
}

interface Metric {
  name: string;
  help: string;
  type: 'counter' | 'gauge';
  series: Map<string, Series>;
}

const registry = new Map<string, Metric>();

function labelKey(labels: Labels | undefined): string {
  if (!labels) return '';
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${String(labels[k])}`).join(',');
}

function ensure(name: string, help: string, type: 'counter' | 'gauge'): Metric {
  let m = registry.get(name);
  if (!m) {
    m = { name, help, type, series: new Map() };
    registry.set(name, m);
  }
  return m;
}

export function registerCounter(name: string, help: string): void {
  ensure(name, help, 'counter');
}

export function registerGauge(name: string, help: string): void {
  ensure(name, help, 'gauge');
}

export function incCounter(name: string, labels?: Labels, by = 1): void {
  const m = ensure(name, name, 'counter');
  const key = labelKey(labels);
  const existing = m.series.get(key);
  if (existing) {
    existing.value += by;
  } else {
    m.series.set(key, { labels: labels ? { ...labels } : {}, value: by });
  }
}

export function setGauge(name: string, value: number, labels?: Labels): void {
  const m = ensure(name, name, 'gauge');
  const key = labelKey(labels);
  m.series.set(key, { labels: labels ? { ...labels } : {}, value });
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels: Labels): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabelValue(String(labels[k]))}"`);
  return `{${parts.join(',')}}`;
}

/** Snapshot Node defaults at format time. */
function sampleNodeDefaults(): void {
  try {
    const mem = process.memoryUsage();
    setGauge('process_resident_memory_bytes', mem.rss);
  } catch {
    // ignore
  }
  setGauge('nodejs_uptime_seconds', Math.round(process.uptime()));
}

export function formatMetrics(): string {
  sampleNodeDefaults();
  const lines: string[] = [];
  for (const metric of registry.values()) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    if (metric.series.size === 0) {
      lines.push(`${metric.name} 0`);
      continue;
    }
    for (const series of metric.series.values()) {
      lines.push(`${metric.name}${formatLabels(series.labels)} ${series.value}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Test-only: reset all metric series. */
export function _resetMetrics(): void {
  registry.clear();
  bootstrap();
}

function bootstrap(): void {
  registerCounter('http_requests_total', 'Count of HTTP requests handled by the API.');
  registerCounter('bot_commands_total', 'Count of Discord slash-command executions.');
  registerCounter('scheduler_ticks_total', 'Count of bot scheduler ticks executed.');
  registerCounter('webhook_deliveries_total', 'Count of inbound webhook delivery attempts.');
  registerCounter('pending_posts_drained_total', 'Count of pending posts drained by the bot.');
  registerGauge('process_resident_memory_bytes', 'Resident memory in bytes (RSS).');
  registerGauge('nodejs_uptime_seconds', 'Process uptime in seconds.');
}

bootstrap();
