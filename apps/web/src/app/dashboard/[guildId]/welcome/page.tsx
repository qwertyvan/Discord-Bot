import { revalidatePath } from 'next/cache';
import type { WelcomeConfig } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

export default async function WelcomePage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const config = await serverFetch<WelcomeConfig>(`/admin/guilds/${guildId}/welcome`);

  async function save(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const enabled = formData.get('enabled') === 'on';
    const channelId = String(formData.get('channelId') ?? '').trim() || null;
    const joinTemplate = String(formData.get('joinTemplate') ?? '').trim() || null;
    const leaveTemplate = String(formData.get('leaveTemplate') ?? '').trim() || null;

    await serverFetch(`/admin/guilds/${gid}/welcome`, {
      method: 'PUT',
      body: { enabled, channelId, joinTemplate, leaveTemplate },
    });
    // Revalidate the whole guild section so the overview tab's "Welcome: On/Off" refreshes too.
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
            defaultChecked={config.enabled}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord focus:ring-discord"
          />
          <span className="text-sm font-medium text-slate-100">
            Send welcome and leave messages
          </span>
        </label>
      </div>

      <Field
        label="Channel ID"
        name="channelId"
        defaultValue={config.channelId ?? ''}
        placeholder="123456789012345678"
        help="Right-click the channel in Discord (with developer mode on) → Copy Channel ID."
        mono
      />

      <Field
        label="Join template"
        name="joinTemplate"
        defaultValue={config.joinTemplate ?? ''}
        placeholder="Welcome to {server}, {user}! 🎉"
        help="Placeholders: {user} {username} {server} {memberCount}"
        textarea
      />

      <Field
        label="Leave template"
        name="leaveTemplate"
        defaultValue={config.leaveTemplate ?? ''}
        placeholder="{username} just left {server}."
        help="Placeholders: {user} {username} {server} {memberCount}"
        textarea
      />

      <button
        type="submit"
        className="rounded-lg bg-discord px-4 py-2 text-sm font-medium text-white transition hover:bg-discord-dark"
      >
        Save
      </button>
    </form>
  );
}

function Field({
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
  const baseInput =
    'mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-slate-600 focus:outline-none';
  return (
    <div>
      <label className="block text-sm font-medium text-slate-200">{label}</label>
      {textarea ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          rows={3}
          className={baseInput}
        />
      ) : (
        <input
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={`${baseInput} ${mono ? 'font-mono' : ''}`}
        />
      )}
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}
