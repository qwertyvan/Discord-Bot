import { revalidatePath } from 'next/cache';
import type { LevelConfig } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

interface LeaderboardResponse {
  entries: Array<{
    rank: number;
    userId: string;
    xp: number;
    voiceMinutes: number;
    level: number;
  }>;
}

export default async function LevelingPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const [cfg, lb] = await Promise.all([
    serverFetch<LevelConfig>(`/admin/guilds/${guildId}/level-config`),
    serverFetch<LeaderboardResponse>(`/admin/guilds/${guildId}/leaderboard`, { query: { limit: 10 } }),
  ]);

  async function save(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const enabled = formData.get('enabled') === 'on';
    const perMessageXp = Number(formData.get('perMessageXp') ?? 15);
    const textCooldownSeconds = Number(formData.get('textCooldownSeconds') ?? 60);
    const voiceXpPerMinute = Number(formData.get('voiceXpPerMinute') ?? 5);
    const levelUpChannelId = String(formData.get('levelUpChannelId') ?? '').trim() || null;
    const levelUpTemplate = String(formData.get('levelUpTemplate') ?? '').trim() || null;

    let channelMultipliers: Record<string, number> = {};
    let roleRewards: Array<{ level: number; roleId: string }> = [];
    let noXpRoleIds: string[] = [];
    try {
      channelMultipliers = JSON.parse(String(formData.get('channelMultipliers') ?? '{}'));
    } catch {
      /* ignore */
    }
    try {
      roleRewards = JSON.parse(String(formData.get('roleRewards') ?? '[]'));
    } catch {
      /* ignore */
    }
    noXpRoleIds = String(formData.get('noXpRoleIds') ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    await serverFetch(`/admin/guilds/${gid}/level-config`, {
      method: 'PUT',
      body: {
        enabled,
        perMessageXp,
        textCooldownSeconds,
        voiceXpPerMinute,
        levelUpChannelId,
        levelUpTemplate,
        channelMultipliers,
        roleRewards,
        noXpRoleIds,
      },
    });
    revalidatePath(`/dashboard/${gid}`, 'layout');
  }

  return (
    <div className="space-y-8">
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
            <span className="text-sm font-medium">Enable XP &amp; leveling</span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="XP per message" name="perMessageXp" defaultValue={cfg.perMessageXp} />
          <NumberField
            label="Text cooldown (sec)"
            name="textCooldownSeconds"
            defaultValue={cfg.textCooldownSeconds}
          />
          <NumberField label="Voice XP / min" name="voiceXpPerMinute" defaultValue={cfg.voiceXpPerMinute} />
        </div>

        <TextField
          label="Level-up channel ID"
          name="levelUpChannelId"
          defaultValue={cfg.levelUpChannelId ?? ''}
          help="Blank → announce in the channel where they leveled up."
          mono
        />
        <TextField
          label="Level-up template"
          name="levelUpTemplate"
          defaultValue={cfg.levelUpTemplate ?? ''}
          placeholder="🎉 {user} just reached level **{level}**!"
          help="Placeholders: {user} {username} {level} {server}"
          textarea
        />

        <TextField
          label="No-XP role IDs"
          name="noXpRoleIds"
          defaultValue={cfg.noXpRoleIds.join(', ')}
          mono
          help="Members holding any of these roles don't earn XP."
        />

        <TextField
          label="Channel multipliers (JSON)"
          name="channelMultipliers"
          defaultValue={JSON.stringify(cfg.channelMultipliers, null, 2)}
          help={`Example: {"123456789012345678": 1.5}`}
          textarea
        />

        <TextField
          label="Role rewards (JSON)"
          name="roleRewards"
          defaultValue={JSON.stringify(cfg.roleRewards, null, 2)}
          help={`Example: [{"level": 5, "roleId": "..."}, {"level": 10, "roleId": "..."}]`}
          textarea
        />

        <button
          type="submit"
          className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
        >
          Save
        </button>
      </form>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Top earners
        </h2>
        {lb.entries.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
            No XP recorded yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            {lb.entries.map((e) => (
              <li key={e.userId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-mono text-xs text-slate-400">#{e.rank}</span>
                <span className="flex-1 truncate font-mono text-xs text-slate-300">{e.userId}</span>
                <span className="text-slate-200">level {e.level}</span>
                <span className="text-slate-400">{e.xp.toLocaleString()} XP</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NumberField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: number;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-400">{label}</label>
      <input
        type="number"
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
      />
    </div>
  );
}

function TextField({
  label,
  name,
  defaultValue,
  placeholder,
  help,
  mono,
  textarea,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
  help?: string;
  mono?: boolean;
  textarea?: boolean;
}) {
  const base =
    'mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-slate-600 focus:outline-none';
  return (
    <div>
      <label className="block text-sm font-medium text-slate-200">{label}</label>
      {textarea ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          rows={6}
          className={`${base} font-mono text-xs`}
        />
      ) : (
        <input
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={`${base} ${mono ? 'font-mono' : ''}`}
        />
      )}
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}
