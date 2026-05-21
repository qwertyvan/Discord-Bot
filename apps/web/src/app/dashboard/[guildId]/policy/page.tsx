import { revalidatePath } from 'next/cache';
import type { WarningPolicy } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

interface ParsedThreshold {
  count: number;
  action: string;
  durationMs?: number;
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const policy = await serverFetch<WarningPolicy>(`/admin/guilds/${guildId}/warning-policy`);

  async function save(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const expireRaw = String(formData.get('expireDays') ?? '').trim();
    const expireDays = expireRaw ? Number(expireRaw) : null;
    const muteRoleId = String(formData.get('muteRoleId') ?? '').trim() || null;
    const thresholdsRaw = String(formData.get('thresholds') ?? '[]');

    let thresholds: ParsedThreshold[] = [];
    try {
      const parsed: unknown = JSON.parse(thresholdsRaw);
      if (Array.isArray(parsed)) thresholds = parsed as ParsedThreshold[];
    } catch {
      // ignore malformed JSON; treated as no change to thresholds.
    }

    await serverFetch(`/admin/guilds/${gid}/warning-policy`, {
      method: 'PUT',
      body: { expireDays, muteRoleId, thresholds },
    });
    revalidatePath(`/dashboard/${gid}`, 'layout');
  }

  return (
    <form action={save} className="space-y-6">
      <input type="hidden" name="guildId" value={guildId} />

      <div>
        <label className="block text-sm font-medium">Warning expiry (days)</label>
        <input
          name="expireDays"
          type="number"
          min={1}
          max={365}
          defaultValue={policy.expireDays ?? ''}
          placeholder="leave blank to never expire"
          className="mt-1 w-48 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-500">
          Warnings older than this many days are marked inactive (and stop counting toward thresholds).
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium">Mute role ID</label>
        <input
          name="muteRoleId"
          defaultValue={policy.muteRoleId ?? ''}
          placeholder="leave blank to use Discord's native timeout"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-slate-500">
          Optional. If set, <code>/mute</code> assigns this role instead of using Discord timeouts.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium">Auto-escalation thresholds (JSON)</label>
        <textarea
          name="thresholds"
          rows={6}
          defaultValue={JSON.stringify(policy.thresholds, null, 2)}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
        />
        <p className="mt-1 text-xs text-slate-500">
          Example: <code>{`[{"count": 3, "action": "TIMEOUT", "durationMs": 3600000}, {"count": 5, "action": "BAN"}]`}</code>.
          Actions: <code>TIMEOUT</code>, <code>KICK</code>, <code>BAN</code>.
        </p>
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
