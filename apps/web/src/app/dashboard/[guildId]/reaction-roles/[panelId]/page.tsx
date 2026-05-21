import { redirect } from 'next/navigation';
import type { ReactionRolePanel } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

export default async function EditPanelPage({
  params,
}: {
  params: Promise<{ guildId: string; panelId: string }>;
}) {
  const { guildId, panelId } = await params;
  const { panels } = await serverFetch<{ panels: ReactionRolePanel[] }>(
    `/admin/guilds/${guildId}/reaction-role-panels`,
  );
  const panel = panels.find((p) => p.id === panelId);
  if (!panel) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
        Panel not found.
      </div>
    );
  }

  const optionPayload = panel.options.map((o) => ({
    roleId: o.roleId,
    label: o.label,
    ...(o.description ? { description: o.description } : {}),
    ...(o.emoji ? { emoji: o.emoji } : {}),
  }));

  async function update(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const pid = String(formData.get('panelId'));
    const name = String(formData.get('name') ?? '').trim();
    const channelId = String(formData.get('channelId') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim() || undefined;
    const exclusive = formData.get('exclusive') === 'on';
    const useDropdown = formData.get('useDropdown') === 'on';
    const optionsRaw = String(formData.get('options') ?? '[]');

    let options: unknown;
    try {
      options = JSON.parse(optionsRaw);
    } catch {
      throw new Error('Options must be valid JSON.');
    }

    await serverFetch(`/admin/guilds/${gid}/reaction-role-panels/${pid}`, {
      method: 'PATCH',
      body: { name, channelId, description, exclusive, useDropdown, options },
    });
    redirect(`/dashboard/${gid}/reaction-roles`);
  }

  return (
    <form action={update} className="space-y-6">
      <input type="hidden" name="guildId" value={guildId} />
      <input type="hidden" name="panelId" value={panelId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Name</label>
          <input
            name="name"
            required
            defaultValue={panel.name}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Channel ID</label>
          <input
            name="channelId"
            required
            defaultValue={panel.channelId}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">Description</label>
        <textarea
          name="description"
          rows={2}
          defaultValue={panel.description ?? ''}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="exclusive"
            defaultChecked={panel.exclusive}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
          />
          <span>Exclusive (only one role at a time)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="useDropdown"
            defaultChecked={panel.useDropdown}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
          />
          <span>Render as dropdown</span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium">Options (JSON)</label>
        <textarea
          name="options"
          rows={12}
          defaultValue={JSON.stringify(optionPayload, null, 2)}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
        />
        <p className="mt-1 text-xs text-slate-500">
          After saving, run <code>/role-panel post name:{panel.name}</code> in Discord to re-publish.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
        >
          Save
        </button>
        <a
          href={`/dashboard/${guildId}/reaction-roles`}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
