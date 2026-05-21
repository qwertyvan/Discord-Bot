import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/api';

const EXAMPLE = `[
  { "roleId": "111111111111111111", "label": "He / him",   "emoji": "🟦" },
  { "roleId": "222222222222222222", "label": "She / her",  "emoji": "🟪" },
  { "roleId": "333333333333333333", "label": "They / them","emoji": "🟩" }
]`;

export default async function NewPanelPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;

  async function create(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
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

    await serverFetch(`/admin/guilds/${gid}/reaction-role-panels`, {
      method: 'POST',
      body: { name, channelId, description, exclusive, useDropdown, options },
    });
    redirect(`/dashboard/${gid}/reaction-roles`);
  }

  return (
    <form action={create} className="space-y-6">
      <input type="hidden" name="guildId" value={guildId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Name</label>
          <input
            name="name"
            required
            placeholder="Pronouns"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Channel ID</label>
          <input
            name="channelId"
            required
            placeholder="123456789012345678"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">Description</label>
        <textarea
          name="description"
          rows={2}
          placeholder="Pick the pronouns you'd like to be addressed by."
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="exclusive"
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
          />
          <span>Exclusive (only one role at a time)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="useDropdown"
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
          />
          <span>Render as dropdown (forced for &gt; 5 options)</span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium">Options (JSON)</label>
        <textarea
          name="options"
          rows={10}
          defaultValue={EXAMPLE}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
        />
        <p className="mt-1 text-xs text-slate-500">
          Each option supports: <code>roleId</code> (required), <code>label</code> (required),
          <code>description</code>, <code>emoji</code> (unicode or <code>&lt;:name:id&gt;</code>).
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
        >
          Create
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
