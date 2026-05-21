import { revalidatePath } from 'next/cache';
import type { IntegrationSubscription } from '@discord-bot/shared';
import { PUBLIC_API_BASE_URL, serverFetch } from '@/lib/api';

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const { integrations } = await serverFetch<{ integrations: IntegrationSubscription[] }>(
    `/admin/guilds/${guildId}/integrations`,
  );

  async function createRss(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    await serverFetch(`/admin/guilds/${gid}/integrations`, {
      method: 'POST',
      body: {
        kind: 'rss',
        name: String(formData.get('name') ?? '').trim(),
        channelId: String(formData.get('channelId') ?? '').trim(),
        rssUrl: String(formData.get('rssUrl') ?? '').trim(),
        ...(formData.get('pollInterval')
          ? { pollInterval: Number(formData.get('pollInterval')) }
          : {}),
      },
    });
    revalidatePath(`/dashboard/${gid}/integrations`);
  }

  async function createWebhook(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const secret = String(formData.get('secret') ?? '').trim();
    await serverFetch(`/admin/guilds/${gid}/integrations`, {
      method: 'POST',
      body: {
        kind: 'webhook',
        name: String(formData.get('name') ?? '').trim(),
        channelId: String(formData.get('channelId') ?? '').trim(),
        ...(secret ? { secret } : {}),
      },
    });
    revalidatePath(`/dashboard/${gid}/integrations`);
  }

  async function createTwitch(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    await serverFetch(`/admin/guilds/${gid}/integrations`, {
      method: 'POST',
      body: {
        kind: 'twitch',
        name: String(formData.get('name') ?? '').trim(),
        channelId: String(formData.get('channelId') ?? '').trim(),
        twitchUsername: String(formData.get('twitchUsername') ?? '').trim(),
      },
    });
    revalidatePath(`/dashboard/${gid}/integrations`);
  }

  async function deleteIntegration(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const id = String(formData.get('id'));
    await serverFetch(`/admin/guilds/${gid}/integrations/${id}`, { method: 'DELETE' });
    revalidatePath(`/dashboard/${gid}/integrations`);
  }

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Active integrations ({integrations.length})
        </h2>
        {integrations.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
            No integrations yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            {integrations.map((i) => {
              const ingressUrl = i.token ? `${PUBLIC_API_BASE_URL}/webhooks/in/${i.token}` : null;
              return (
                <li key={i.id} className="px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div>
                        <span className="rounded-md border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                          {i.kind}
                        </span>{' '}
                        <span className="font-medium text-slate-100">{i.name}</span>{' '}
                        <span className="text-xs text-slate-500">
                          · channel <span className="font-mono">{i.channelId}</span>
                          {!i.enabled && ' · disabled'}
                        </span>
                      </div>
                      {i.kind === 'rss' && (
                        <div className="mt-1 break-all text-xs text-slate-400">
                          <span className="font-mono">{i.rssUrl}</span>
                          <span className="ml-2 text-slate-500">poll {i.pollInterval}s</span>
                        </div>
                      )}
                      {i.kind === 'webhook' && ingressUrl && (
                        <div className="mt-1 break-all text-xs text-slate-400">
                          POST <span className="font-mono">{ingressUrl}</span>
                          {i.secret && (
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              Sign with HMAC-SHA256 of the JSON body, header{' '}
                              <code>X-Signature-256: sha256=&lt;hex&gt;</code>.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <form action={deleteIntegration}>
                      <input type="hidden" name="guildId" value={guildId} />
                      <input type="hidden" name="id" value={i.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-800/60 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Add an RSS feed
        </h2>
        <form action={createRss} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="guildId" value={guildId} />
          <Field label="Name" name="name" placeholder="My Blog" required />
          <Field label="Channel ID" name="channelId" placeholder="123…" mono required />
          <Field label="Feed URL" name="rssUrl" placeholder="https://example.com/feed.xml" required full />
          <Field
            label="Poll interval (seconds)"
            name="pollInterval"
            placeholder="600"
            type="number"
          />
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
            >
              Add RSS
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Add an incoming webhook
        </h2>
        <form action={createWebhook} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="guildId" value={guildId} />
          <Field label="Name" name="name" placeholder="GitHub PRs" required />
          <Field label="Channel ID" name="channelId" placeholder="123…" mono required />
          <Field
            label="Shared secret (optional)"
            name="secret"
            placeholder="HMAC secret (omit for unauth)"
            full
          />
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
            >
              Generate webhook URL
            </button>
            <p className="mt-2 text-xs text-slate-500">
              The URL is shown once after creation. Accepts JSON with any of{' '}
              <code>content</code>, <code>message</code>, <code>text</code>, <code>title</code>, or{' '}
              <code>embed</code>. Sending GitHub webhook events to this URL renders rich
              push/PR/issue/release embeds automatically.
            </p>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Add a Twitch live notification
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          First set <code>twitch.client_id</code> and <code>twitch.client_secret</code> on the{' '}
          <a className="underline" href={`/dashboard/${guildId}/credentials`}>
            Credentials
          </a>{' '}
          tab. Get them from{' '}
          <a className="underline" href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">
            dev.twitch.tv
          </a>{' '}
          (any redirect URI is fine).
        </p>
        <form action={createTwitch} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="guildId" value={guildId} />
          <Field label="Name" name="name" placeholder="shroud live" required />
          <Field label="Channel ID (where to post)" name="channelId" placeholder="123…" mono required />
          <Field
            label="Twitch username"
            name="twitchUsername"
            placeholder="shroud"
            mono
            required
            full
          />
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white hover:bg-discord-dark"
            >
              Add Twitch
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  placeholder,
  required,
  mono,
  full,
  type = 'text',
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  mono?: boolean;
  full?: boolean;
  type?: 'text' | 'number';
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="block text-xs uppercase tracking-wide text-slate-400">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm ${
          mono ? 'font-mono text-xs' : ''
        }`}
      />
    </div>
  );
}
