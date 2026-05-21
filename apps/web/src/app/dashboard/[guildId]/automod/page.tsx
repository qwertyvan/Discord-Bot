import { revalidatePath } from 'next/cache';
import type { AutomodConfig } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

const RULE_HINTS = `Default starter rules JSON:

{
  "antispam":   { "enabled": true,  "action": "TIMEOUT", "windowSeconds": 5,  "threshold": 6, "durationMs": 300000 },
  "antiinvite": { "enabled": true,  "action": "DELETE",  "allowedGuildIds": [] },
  "massmention":{ "enabled": true,  "action": "DELETE",  "threshold": 8 },
  "caps":       { "enabled": false, "action": "DELETE",  "minLength": 20, "threshold": 0.7 },
  "emojispam":  { "enabled": false, "action": "DELETE",  "threshold": 10 },
  "zalgo":      { "enabled": false, "action": "DELETE",  "threshold": 0.3 },
  "badwords":   { "enabled": false, "action": "DELETE",  "words": [], "matchSubstring": false },
  "links":      { "enabled": false, "action": "DELETE",  "mode": "block", "domains": [] },
  "phishing":   { "enabled": true,  "action": "BAN",     "staticDomains": [] },
  "newaccount": { "enabled": false, "action": "KICK",    "ageDays": 7 },
  "raid":       { "enabled": true,  "action": "NONE",    "joinThreshold": 10, "windowSeconds": 30 }
}`;

export default async function AutomodPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const cfg = await serverFetch<AutomodConfig>(`/admin/guilds/${guildId}/automod-config`);

  async function save(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const enabled = formData.get('enabled') === 'on';
    const exemptRoleIds = String(formData.get('exemptRoleIds') ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const exemptChannelIds = String(formData.get('exemptChannelIds') ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    let rules: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(String(formData.get('rules') ?? '{}'));
      if (parsed && typeof parsed === 'object') rules = parsed as Record<string, unknown>;
    } catch {
      // malformed JSON: keep existing rules by sending empty patch
    }

    await serverFetch(`/admin/guilds/${gid}/automod-config`, {
      method: 'PUT',
      body: { enabled, exemptRoleIds, exemptChannelIds, rules },
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
          <span className="text-sm font-medium">Master switch — enable all automod rules</span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium">Exempt role IDs</label>
        <input
          name="exemptRoleIds"
          defaultValue={cfg.exemptRoleIds.join(', ')}
          placeholder="role IDs (comma- or space-separated)"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
        />
        <p className="mt-1 text-xs text-slate-500">
          Members holding any of these roles bypass every automod rule. Useful for staff.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium">Exempt channel IDs</label>
        <input
          name="exemptChannelIds"
          defaultValue={cfg.exemptChannelIds.join(', ')}
          placeholder="channel IDs (comma- or space-separated)"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
        />
        <p className="mt-1 text-xs text-slate-500">
          Messages in these channels skip automod entirely.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium">Rules (JSON)</label>
        <textarea
          name="rules"
          rows={20}
          defaultValue={JSON.stringify(cfg.rules, null, 2)}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
        />
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
            Show example rules JSON
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-900/60 p-3 text-xs text-slate-300">
            {RULE_HINTS}
          </pre>
        </details>
        <p className="mt-1 text-xs text-slate-500">
          Each rule supports: <code>enabled</code>, <code>action</code> (one of{' '}
          <code>DELETE WARN TIMEOUT KICK BAN NONE</code>), and optional <code>durationMs</code>.
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
