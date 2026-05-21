import type { AuditEvent, AuditEventType } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

const TYPE_LABEL: Record<AuditEventType, string> = {
  MESSAGE_DELETE: '🗑️ Message delete',
  MESSAGE_EDIT: '✏️ Message edit',
  MEMBER_JOIN: '📥 Member join',
  MEMBER_LEAVE: '📤 Member leave',
  MEMBER_ROLE_ADD: '➕ Role added',
  MEMBER_ROLE_REMOVE: '➖ Role removed',
  MEMBER_NICKNAME_CHANGE: '🪪 Nickname change',
  CHANNEL_CREATE: '📺 Channel create',
  CHANNEL_DELETE: '🗑️ Channel delete',
  VOICE_JOIN: '🔊 Voice join',
  VOICE_LEAVE: '🔇 Voice leave',
  MOD_ACTION: '🛡️ Mod action',
};

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ type?: string; userId?: string }>;
}) {
  const { guildId } = await params;
  const { type, userId } = await searchParams;

  const query: Record<string, string | number | undefined> = { limit: 100 };
  if (type) query.type = type;
  if (userId) query.userId = userId;

  const { events } = await serverFetch<{ events: AuditEvent[] }>(
    `/admin/guilds/${guildId}/audit-events`,
    { query },
  );

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400">Type</label>
          <select
            name="type"
            defaultValue={type ?? ''}
            className="mt-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400">User ID</label>
          <input
            name="userId"
            defaultValue={userId ?? ''}
            placeholder="123456789012345678"
            className="mt-1 w-64 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Filter
        </button>
      </form>

      {events.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No audit events match. Enable logging on the Logging tab if you haven't already.
        </div>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[160px_1fr] gap-3 px-4 py-3 text-sm">
              <div className="text-xs text-slate-500">{new Date(e.createdAt).toLocaleString()}</div>
              <div>
                <div className="font-medium text-slate-100">{TYPE_LABEL[e.type] ?? e.type}</div>
                <div className="text-xs text-slate-400">
                  {e.userId && <>user <span className="font-mono">{e.userId}</span> · </>}
                  {e.channelId && <>channel <span className="font-mono">{e.channelId}</span></>}
                </div>
                {Object.keys(e.payload ?? {}).length > 0 && (
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-900/60 p-2 text-xs text-slate-300">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
