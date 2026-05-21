import { revalidatePath } from 'next/cache';
import type { ModAction, ModActionType } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

const TYPE_LABEL: Record<ModActionType, string> = {
  WARN: 'Warn',
  KICK: 'Kick',
  BAN: 'Ban',
  UNBAN: 'Unban',
  SOFTBAN: 'Softban',
  TIMEOUT: 'Timeout',
  UNTIMEOUT: 'Untimeout',
  MUTE: 'Mute',
  UNMUTE: 'Unmute',
  NOTE: 'Note',
};

const TYPE_COLOR: Record<ModActionType, string> = {
  WARN: 'bg-yellow-900/40 text-yellow-300 border-yellow-800',
  KICK: 'bg-red-900/40 text-red-300 border-red-800',
  BAN: 'bg-red-900/40 text-red-300 border-red-800',
  SOFTBAN: 'bg-red-900/40 text-red-300 border-red-800',
  UNBAN: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  TIMEOUT: 'bg-yellow-900/40 text-yellow-300 border-yellow-800',
  UNTIMEOUT: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  MUTE: 'bg-yellow-900/40 text-yellow-300 border-yellow-800',
  UNMUTE: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  NOTE: 'bg-blue-900/40 text-blue-300 border-blue-800',
};

export default async function ModLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ type?: string; userId?: string }>;
}) {
  const { guildId } = await params;
  const { type, userId } = await searchParams;

  const query: Record<string, string | number | undefined> = { limit: 50 };
  if (type) query.type = type;
  if (userId) query.userId = userId;

  const { actions } = await serverFetch<{ actions: ModAction[]; nextCursor: string | null }>(
    `/admin/guilds/${guildId}/mod-actions`,
    { query },
  );

  async function deleteAction(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const actionId = String(formData.get('actionId'));
    await serverFetch(`/admin/guilds/${gid}/mod-actions/${actionId}`, { method: 'DELETE' });
    revalidatePath(`/dashboard/${gid}`, 'layout');
  }

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

      {actions.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No moderation actions match.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Case</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Moderator</th>
                <th className="px-4 py-2 font-medium">Reason</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950/40">
              {actions.map((a) => (
                <tr key={a.id} className={a.active ? '' : 'opacity-60'}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">#{a.caseNumber}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md border px-2 py-0.5 text-xs ${TYPE_COLOR[a.type]}`}>
                      {TYPE_LABEL[a.type]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">{a.userId}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">{a.moderatorId}</td>
                  <td className="px-4 py-3 text-slate-200">{a.reason}</td>
                  <td className="px-4 py-3 text-right">
                    <form action={deleteAction}>
                      <input type="hidden" name="actionId" value={a.id} />
                      <input type="hidden" name="guildId" value={guildId} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-800/60 px-2 py-1 text-xs text-red-300 transition hover:bg-red-900/30"
                      >
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
