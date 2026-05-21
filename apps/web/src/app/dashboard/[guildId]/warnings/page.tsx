import { revalidatePath } from 'next/cache';
import type { Warning } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

export default async function WarningsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const { warnings } = await serverFetch<{ warnings: Warning[]; nextCursor: string | null }>(
    `/admin/guilds/${guildId}/warnings`,
    { query: { limit: 50 } },
  );

  async function deleteWarning(formData: FormData): Promise<void> {
    'use server';
    const warningId = String(formData.get('warningId'));
    const gid = String(formData.get('guildId'));
    await serverFetch(`/admin/guilds/${gid}/warnings/${warningId}`, { method: 'DELETE' });
    // Revalidate the whole guild section so the overview tab's warning counts refresh too.
    revalidatePath(`/dashboard/${gid}`, 'layout');
  }

  if (warnings.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
        No warnings issued in this server.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/60 text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-4 py-2 font-medium">User</th>
            <th className="px-4 py-2 font-medium">Moderator</th>
            <th className="px-4 py-2 font-medium">Reason</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 bg-slate-950/40">
          {warnings.map((w) => (
            <tr key={w.id}>
              <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                {new Date(w.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-300">{w.userId}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-300">{w.moderatorId}</td>
              <td className="px-4 py-3 text-slate-200">{w.reason}</td>
              <td className="px-4 py-3 text-right">
                <form action={deleteWarning}>
                  <input type="hidden" name="warningId" value={w.id} />
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
  );
}
