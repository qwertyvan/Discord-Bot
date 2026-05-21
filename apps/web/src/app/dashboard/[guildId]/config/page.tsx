import { serverFetch } from '@/lib/api';

interface AdminActionRow {
  id: string;
  userId: string;
  method: string;
  path: string;
  summary: Record<string, unknown>;
  status: number;
  createdAt: string;
}

export default async function ConfigAuditPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const { actions } = await serverFetch<{ actions: AdminActionRow[] }>(
    `/admin/guilds/${guildId}/admin-actions`,
    { query: { limit: 100 } },
  );

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Export / import
        </h2>
        <div className="space-y-3">
          <a
            href={`/dashboard/${guildId}/config/export`}
            className="inline-block rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
          >
            Download config as JSON
          </a>
          <p className="text-xs text-slate-500">
            Backup of welcome / logging / warning policy / automod / verification / leveling /
            economy / tickets / shop / reaction roles / tags / auto-responses. Excludes per-user
            state (warnings, balances, XP, tickets).
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Admin action log
        </h2>
        {actions.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
            No dashboard actions yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            {actions.map((a) => (
              <li key={a.id} className="px-4 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="rounded-md border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                      {a.method}
                    </span>{' '}
                    <span className="font-mono text-xs text-slate-300">{a.path}</span>{' '}
                    <span className="text-xs text-slate-500">
                      · by <span className="font-mono">{a.userId}</span> · {a.status}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </div>
                {Object.keys(a.summary ?? {}).length > 0 && (
                  <pre className="mt-1 max-h-24 overflow-auto rounded bg-slate-900/60 p-2 text-[11px] text-slate-300">
                    {JSON.stringify(a.summary, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
