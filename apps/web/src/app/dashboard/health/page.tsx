import { serverFetch, ApiError } from '@/lib/api';

interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: {
    db: { ok: boolean; latencyMs?: number; error?: string };
    bot: { ok: boolean; heartbeatAgeSeconds: number | null };
  };
}

type TileTone = 'ok' | 'warn' | 'fail';

function Tile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: TileTone;
}) {
  const toneClasses: Record<TileTone, string> = {
    ok: 'border-emerald-700/60 bg-emerald-900/20 text-emerald-200',
    warn: 'border-amber-700/60 bg-amber-900/20 text-amber-200',
    fail: 'border-rose-700/60 bg-rose-900/20 text-rose-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${toneClasses[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {detail ? <div className="mt-1 text-xs opacity-80">{detail}</div> : null}
    </div>
  );
}

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  let health: HealthResponse | null = null;
  let fetchError: string | null = null;
  try {
    health = await serverFetch<HealthResponse>('/health');
  } catch (err) {
    fetchError =
      err instanceof ApiError ? `${err.status} ${err.message}` : (err as Error).message;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">System health</h1>
      <p className="mt-1 text-sm text-slate-400">
        Live status from the API. The bot heartbeat is refreshed every 30 seconds.
      </p>

      {fetchError ? (
        <div className="mt-6 rounded-lg border border-rose-800 bg-rose-900/40 p-4 text-sm text-rose-200">
          Failed to reach the API: {fetchError}
        </div>
      ) : health ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Tile
            label="Overall"
            value={health.status === 'ok' ? 'Operational' : 'Degraded'}
            tone={health.status === 'ok' ? 'ok' : 'warn'}
          />
          <Tile
            label="API → Database"
            value={health.checks.db.ok ? 'Reachable' : 'Unavailable'}
            detail={
              health.checks.db.ok && health.checks.db.latencyMs !== undefined
                ? `SELECT 1 in ${health.checks.db.latencyMs} ms`
                : health.checks.db.error
            }
            tone={health.checks.db.ok ? 'ok' : 'fail'}
          />
          <Tile
            label="Bot heartbeat"
            value={
              health.checks.bot.heartbeatAgeSeconds === null
                ? 'No heartbeat yet'
                : `${health.checks.bot.heartbeatAgeSeconds}s ago`
            }
            detail={
              health.checks.bot.ok
                ? 'Bot is reporting in normally.'
                : 'Bot has not reported in recently.'
            }
            tone={
              health.checks.bot.heartbeatAgeSeconds === null
                ? 'fail'
                : health.checks.bot.ok
                  ? 'ok'
                  : 'warn'
            }
          />
        </div>
      ) : null}

      <div className="mt-8 text-xs text-slate-500">
        Prometheus-format metrics are scraped from <code>/metrics</code> on the API.
      </div>
    </div>
  );
}
