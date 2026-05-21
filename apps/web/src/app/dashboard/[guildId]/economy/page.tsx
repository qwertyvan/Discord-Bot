import { revalidatePath } from 'next/cache';
import type { EconomyConfig, ShopItem } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

interface LbEntry {
  rank: number;
  userId: string;
  amount: number;
}

export default async function EconomyPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const [cfg, shop, lb] = await Promise.all([
    serverFetch<EconomyConfig>(`/admin/guilds/${guildId}/economy-config`),
    serverFetch<{ items: ShopItem[] }>(`/admin/guilds/${guildId}/shop`),
    serverFetch<{ entries: LbEntry[] }>(`/admin/guilds/${guildId}/economy-leaderboard`, {
      query: { limit: 10 },
    }),
  ]);

  async function save(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const body = {
      enabled: formData.get('enabled') === 'on',
      currencyName: String(formData.get('currencyName') ?? 'coins').trim() || 'coins',
      currencySymbol: String(formData.get('currencySymbol') ?? '🪙').trim() || '🪙',
      startingBalance: Number(formData.get('startingBalance') ?? 0),
      dailyReward: Number(formData.get('dailyReward') ?? 100),
      dailyCooldownSeconds: Number(formData.get('dailyCooldownSeconds') ?? 86_400),
      workMin: Number(formData.get('workMin') ?? 20),
      workMax: Number(formData.get('workMax') ?? 80),
      workCooldownSeconds: Number(formData.get('workCooldownSeconds') ?? 3600),
      gamblingEnabled: formData.get('gamblingEnabled') === 'on',
    };
    await serverFetch(`/admin/guilds/${gid}/economy-config`, { method: 'PUT', body });
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
            <span className="text-sm font-medium">Enable economy</span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Currency name" name="currencyName" defaultValue={cfg.currencyName} />
          <Field label="Currency symbol" name="currencySymbol" defaultValue={cfg.currencySymbol} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starting balance" name="startingBalance" type="number" defaultValue={String(cfg.startingBalance)} />
          <Field label="Daily reward" name="dailyReward" type="number" defaultValue={String(cfg.dailyReward)} />
          <Field
            label="Daily cooldown (sec)"
            name="dailyCooldownSeconds"
            type="number"
            defaultValue={String(cfg.dailyCooldownSeconds)}
          />
          <Field label="Work min" name="workMin" type="number" defaultValue={String(cfg.workMin)} />
          <Field label="Work max" name="workMax" type="number" defaultValue={String(cfg.workMax)} />
          <Field
            label="Work cooldown (sec)"
            name="workCooldownSeconds"
            type="number"
            defaultValue={String(cfg.workCooldownSeconds)}
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="gamblingEnabled"
              defaultChecked={cfg.gamblingEnabled}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
            />
            <span className="text-sm">Allow /gamble (coinflip + slots)</span>
          </label>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
        >
          Save
        </button>
      </form>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Shop ({shop.items.length})
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Add/remove items via <code>/shop add</code> and <code>/shop remove</code> in Discord (requires Manage Guild).
        </p>
        {shop.items.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
            The shop is empty.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            {shop.items.map((i) => (
              <li key={i.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-100">
                      {i.name}{' '}
                      <span className="ml-2 text-xs text-slate-400">
                        {cfg.currencySymbol} {i.price.toLocaleString()}
                      </span>
                    </div>
                    {i.description && <div className="text-xs text-slate-500">{i.description}</div>}
                  </div>
                  <div className="text-xs text-slate-400">
                    {i.kind === 'role' && i.roleId && <>role <span className="font-mono">{i.roleId}</span></>}
                    {i.stock !== null && <span className="ml-3">stock: {i.stock}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Top balances
        </h2>
        {lb.entries.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
            No balances yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            {lb.entries.map((e) => (
              <li key={e.userId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-mono text-xs text-slate-400">#{e.rank}</span>
                <span className="flex-1 truncate font-mono text-xs text-slate-300">{e.userId}</span>
                <span className="text-slate-200">
                  {cfg.currencySymbol} {e.amount.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: 'text' | 'number';
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-400">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
      />
    </div>
  );
}
