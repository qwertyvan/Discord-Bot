import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import type { ReactionRolePanel } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

export default async function ReactionRolesPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const { panels } = await serverFetch<{ panels: ReactionRolePanel[] }>(
    `/admin/guilds/${guildId}/reaction-role-panels`,
  );

  async function deletePanel(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const panelId = String(formData.get('panelId'));
    await serverFetch(`/admin/guilds/${gid}/reaction-role-panels/${panelId}`, { method: 'DELETE' });
    revalidatePath(`/dashboard/${gid}`, 'layout');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Define button or dropdown panels that let members self-assign roles.
        </p>
        <Link
          href={`/dashboard/${guildId}/reaction-roles/new`}
          className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
        >
          New panel
        </Link>
      </div>

      {panels.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No reaction-role panels configured.
        </div>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
          {panels.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-100">{p.name}</div>
                <div className="text-xs text-slate-400">
                  channel <span className="font-mono">{p.channelId}</span> · {p.options.length} option
                  {p.options.length === 1 ? '' : 's'} ·{' '}
                  {p.useDropdown ? 'dropdown' : 'buttons'} ·{' '}
                  {p.exclusive ? 'exclusive' : 'multi-select'} ·{' '}
                  {p.messageId ? 'posted' : 'not posted'}
                </div>
                {p.description && <div className="mt-1 text-xs text-slate-500">{p.description}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/${guildId}/reaction-roles/${p.id}`}
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                >
                  Edit
                </Link>
                <form action={deletePanel}>
                  <input type="hidden" name="guildId" value={guildId} />
                  <input type="hidden" name="panelId" value={p.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-red-800/60 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30"
                  >
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
