import { revalidatePath } from 'next/cache';
import type { Ticket, TicketCategory, TicketConfig } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { guildId } = await params;
  const { status } = await searchParams;
  const [cfg, cats, list] = await Promise.all([
    serverFetch<TicketConfig>(`/admin/guilds/${guildId}/ticket-config`),
    serverFetch<{ categories: TicketCategory[] }>(
      `/admin/guilds/${guildId}/ticket-categories`,
    ),
    serverFetch<{ tickets: Ticket[] }>(`/admin/guilds/${guildId}/tickets`, {
      query: { status: status ?? 'open', limit: 50 },
    }),
  ]);

  async function save(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const body = {
      enabled: formData.get('enabled') === 'on',
      panelChannelId: String(formData.get('panelChannelId') ?? '').trim() || null,
      staffRoleId: String(formData.get('staffRoleId') ?? '').trim() || null,
      transcriptChannelId: String(formData.get('transcriptChannelId') ?? '').trim() || null,
      transcriptsEnabled: formData.get('transcriptsEnabled') === 'on',
      slaReminderSeconds: parseNullableInt(String(formData.get('slaReminderSeconds') ?? '')),
      idleAutoCloseSeconds: parseNullableInt(String(formData.get('idleAutoCloseSeconds') ?? '')),
    };
    await serverFetch(`/admin/guilds/${gid}/ticket-config`, { method: 'PUT', body });
    revalidatePath(`/dashboard/${gid}`, 'layout');
  }

  return (
    <div className="space-y-8">
      <form action={save} className="space-y-4">
        <input type="hidden" name="guildId" value={guildId} />
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={cfg.enabled}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
            />
            <span className="text-sm font-medium">Enable tickets</span>
          </label>
          <p className="mt-2 text-xs text-slate-500">
            After saving, run <code>/ticket-setup</code> in Discord to publish the panel button.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Panel parent channel ID"
            name="panelChannelId"
            defaultValue={cfg.panelChannelId ?? ''}
          />
          <Field
            label="Default staff role ID"
            name="staffRoleId"
            defaultValue={cfg.staffRoleId ?? ''}
          />
          <Field
            label="Transcript channel ID"
            name="transcriptChannelId"
            defaultValue={cfg.transcriptChannelId ?? ''}
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="transcriptsEnabled"
              defaultChecked={cfg.transcriptsEnabled}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
            />
            <span className="text-sm font-medium">Generate HTML transcripts on close</span>
          </label>
          <p className="mt-2 text-xs text-slate-500">
            Renders the ticket-thread history as a stand-alone HTML file and
            posts it to the transcript channel (or the ticket thread if not set).
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="SLA reminder after (seconds)"
            name="slaReminderSeconds"
            type="number"
            defaultValue={cfg.slaReminderSeconds !== null ? String(cfg.slaReminderSeconds) : ''}
          />
          <Field
            label="Auto-close idle after (seconds)"
            name="idleAutoCloseSeconds"
            type="number"
            defaultValue={
              cfg.idleAutoCloseSeconds !== null ? String(cfg.idleAutoCloseSeconds) : ''
            }
          />
        </div>

        <button
          type="submit"
          className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
        >
          Save
        </button>
      </form>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Stats
        </h2>
        <StatGrid guildId={guildId} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Categories ({cats.categories.length})
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Manage via <code>/ticket-category add|list|remove</code> in Discord.
        </p>
        {cats.categories.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
            No categories yet — a single Open button will be shown on the panel.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            {cats.categories.map((c) => (
              <li key={c.id} className="px-4 py-3 text-sm">
                <span className="mr-1">{c.emoji ?? '•'}</span>
                <span className="font-medium text-slate-100">{c.name}</span>
                {c.description && <span className="ml-2 text-xs text-slate-500">— {c.description}</span>}
                {c.staffRoleId && (
                  <span className="ml-2 text-xs text-slate-400">
                    staff <span className="font-mono">{c.staffRoleId}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Tickets — {status === 'closed' ? 'closed' : 'open'} ({list.tickets.length})
        </h2>
        <div className="mb-3 flex gap-2 text-xs">
          <a
            href={`/dashboard/${guildId}/tickets?status=open`}
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
          >
            Open
          </a>
          <a
            href={`/dashboard/${guildId}/tickets?status=closed`}
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
          >
            Closed
          </a>
        </div>
        {list.tickets.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
            No tickets match.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            {list.tickets.map((t) => (
              <li key={t.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-100">
                      #{t.number}{' '}
                      <span className="ml-2 text-xs text-slate-400">{t.status}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      user <span className="font-mono">{t.userId}</span> · channel{' '}
                      <span className="font-mono">{t.channelId}</span>
                      {t.assignedTo && (
                        <> · assigned <span className="font-mono">{t.assignedTo}</span></>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>opened {new Date(t.openedAt).toLocaleString()}</div>
                    {t.closedAt && <div>closed {new Date(t.closedAt).toLocaleString()}</div>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: 'text' | 'number';
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-400">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        className={`mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 ${type === 'number' ? 'text-sm' : 'font-mono text-xs'}`}
      />
    </div>
  );
}

function parseNullableInt(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function StatGrid({ guildId }: { guildId: string }) {
  const stats = await serverFetch<{
    openCount: number;
    closedCount: number;
    openedLast7d: number;
    closedLast7d: number;
    avgResolutionSeconds: number;
  }>(`/admin/guilds/${guildId}/tickets/stats`);
  const avg = stats.avgResolutionSeconds;
  const avgLabel =
    avg === 0
      ? '—'
      : avg < 60
        ? `${avg}s`
        : avg < 3600
          ? `${Math.round(avg / 60)}m`
          : avg < 86400
            ? `${(avg / 3600).toFixed(1)}h`
            : `${(avg / 86400).toFixed(1)}d`;
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat label="Open" value={stats.openCount} />
      <Stat label="Closed" value={stats.closedCount} />
      <Stat label="Opened (7d)" value={stats.openedLast7d} />
      <Stat label="Closed (7d)" value={stats.closedLast7d} />
      <Stat label="Avg time-to-close" value={avgLabel} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}
