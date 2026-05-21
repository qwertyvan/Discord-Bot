import { revalidatePath } from 'next/cache';
import { serverFetch } from '@/lib/api';

interface CredentialRow {
  guildId: string;
  provider: string;
  key: string;
  hasValue: boolean;
  updatedAt: string;
}

export default async function CredentialsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const { credentials } = await serverFetch<{ credentials: CredentialRow[] }>(
    `/admin/guilds/${guildId}/integration-credentials`,
  );

  async function save(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    await serverFetch(`/admin/guilds/${gid}/integration-credentials`, {
      method: 'PUT',
      body: {
        provider: String(formData.get('provider') ?? '').trim(),
        key: String(formData.get('key') ?? '').trim(),
        value: String(formData.get('value') ?? '').trim(),
      },
    });
    revalidatePath(`/dashboard/${gid}/credentials`);
  }

  async function remove(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const provider = String(formData.get('provider'));
    const key = String(formData.get('key'));
    await serverFetch(
      `/admin/guilds/${gid}/integration-credentials/${provider}/${key}`,
      { method: 'DELETE' },
    );
    revalidatePath(`/dashboard/${gid}/credentials`);
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Stored credentials ({credentials.length})
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Values are envelope-encrypted at rest. Common providers: <code>twitch</code> with keys{' '}
          <code>client_id</code> and <code>client_secret</code>.
        </p>
        {credentials.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
            No credentials stored.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            {credentials.map((c) => (
              <li
                key={`${c.provider}/${c.key}`}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <div>
                  <span className="font-mono text-slate-100">
                    {c.provider}.{c.key}
                  </span>
                  <span className="ml-3 text-xs text-slate-500">
                    {c.hasValue ? '••• stored' : '(empty)'} · updated{' '}
                    {new Date(c.updatedAt).toLocaleString()}
                  </span>
                </div>
                <form action={remove}>
                  <input type="hidden" name="guildId" value={guildId} />
                  <input type="hidden" name="provider" value={c.provider} />
                  <input type="hidden" name="key" value={c.key} />
                  <button
                    type="submit"
                    className="rounded-md border border-red-800/60 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Add / update credential
        </h2>
        <form action={save} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="guildId" value={guildId} />
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-400">Provider</label>
            <input
              name="provider"
              required
              placeholder="twitch"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-400">Key</label>
            <input
              name="key"
              required
              placeholder="client_id"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-400">Value</label>
            <input
              name="value"
              required
              type="password"
              placeholder="paste secret"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
            >
              Save
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
