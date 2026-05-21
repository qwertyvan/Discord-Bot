import { revalidatePath } from 'next/cache';
import type { VerificationConfig } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

export default async function VerificationPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const cfg = await serverFetch<VerificationConfig>(`/admin/guilds/${guildId}/verification`);

  async function save(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const enabled = formData.get('enabled') === 'on';
    const channelId = String(formData.get('channelId') ?? '').trim() || null;
    const verifiedRoleId = String(formData.get('verifiedRoleId') ?? '').trim() || null;
    const buttonLabel = String(formData.get('buttonLabel') ?? '').trim() || null;
    const prompt = String(formData.get('prompt') ?? '').trim() || null;
    await serverFetch(`/admin/guilds/${gid}/verification`, {
      method: 'PUT',
      body: { enabled, channelId, verifiedRoleId, buttonLabel, prompt },
    });
    revalidatePath(`/dashboard/${gid}`, 'layout');
  }

  return (
    <form action={save} className="space-y-6">
      <input type="hidden" name="guildId" value={guildId} />

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={cfg.enabled}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
          />
          <span className="text-sm font-medium">Require verification button to gain access</span>
        </label>
        <p className="mt-2 text-xs text-slate-500">
          Set this role's permissions so unverified members can only see the verification channel.
          Use <code>/verify-setup</code> from Discord to post the button after saving.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium">Verified role ID</label>
        <input
          name="verifiedRoleId"
          defaultValue={cfg.verifiedRoleId ?? ''}
          placeholder="123456789012345678"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Channel ID (for the button)</label>
        <input
          name="channelId"
          defaultValue={cfg.channelId ?? ''}
          placeholder="123456789012345678"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Button label</label>
        <input
          name="buttonLabel"
          defaultValue={cfg.buttonLabel ?? ''}
          placeholder="Verify"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Prompt</label>
        <textarea
          name="prompt"
          defaultValue={cfg.prompt ?? ''}
          rows={3}
          placeholder="Click the button below to verify and gain access to the server."
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
      >
        Save
      </button>
    </form>
  );
}
