import { revalidatePath } from 'next/cache';
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
        <div className="flex flex-wrap gap-3">
          <a
            href={`/dashboard/${guildId}/config/export`}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
          >
            Download config as JSON
          </a>
          <a
            href={`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/admin/guilds/${guildId}/events.ics`}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
          >
            Download events.ics
          </a>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          JSON export covers welcome / logging / warning policy / automod / verification / leveling /
          economy / tickets / shop / reaction roles / tags / auto-responses. ICS export contains
          every event (past + upcoming) for calendar import.
        </p>
      </section>

      <ImportSection guildId={guildId} />


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

async function ImportSection({ guildId }: { guildId: string }) {
  async function runImport(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const dryRun = formData.get('dryRun') === 'on';
    const raw = String(formData.get('payload') ?? '').trim();
    if (!raw) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    await serverFetch(`/admin/guilds/${gid}/import`, {
      method: 'POST',
      body: { payload, dryRun },
    });
    revalidatePath(`/dashboard/${gid}/config`);
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
        Import config
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Paste the JSON from <em>Download config</em>. Per-guild config sections (welcome, logging,
        warning policy, automod, verification, leveling, economy, ticket config) are upserted.
        Collection sections (shop items, reaction-role panels, tags, auto-responses, ticket
        categories) are intentionally skipped — their delete-then-insert semantics warrant a
        diff UX that isn't built yet.
      </p>
      <form action={runImport} className="space-y-3">
        <input type="hidden" name="guildId" value={guildId} />
        <textarea
          name="payload"
          rows={14}
          placeholder='{"welcome": { ... }, ... }'
          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="dryRun"
            defaultChecked
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
          />
          <span>Dry-run (validate only — uncheck to actually apply)</span>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
        >
          Run import
        </button>
      </form>
    </section>
  );
}
