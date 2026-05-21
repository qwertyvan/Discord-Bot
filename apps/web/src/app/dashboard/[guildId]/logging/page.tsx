import { revalidatePath } from 'next/cache';
import type { AuditEventType, LoggingConfig } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

const EVENT_LABEL: Record<AuditEventType, string> = {
  MESSAGE_DELETE: 'Message delete',
  MESSAGE_EDIT: 'Message edit',
  MEMBER_JOIN: 'Member join',
  MEMBER_LEAVE: 'Member leave',
  MEMBER_ROLE_ADD: 'Role added',
  MEMBER_ROLE_REMOVE: 'Role removed',
  MEMBER_NICKNAME_CHANGE: 'Nickname change',
  CHANNEL_CREATE: 'Channel create',
  CHANNEL_DELETE: 'Channel delete',
  VOICE_JOIN: 'Voice join',
  VOICE_LEAVE: 'Voice leave',
  MOD_ACTION: 'Mod action',
};

const ALL_EVENTS = Object.keys(EVENT_LABEL) as AuditEventType[];

export default async function LoggingPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const cfg = await serverFetch<LoggingConfig>(`/admin/guilds/${guildId}/logging-config`);

  async function save(formData: FormData): Promise<void> {
    'use server';
    const gid = String(formData.get('guildId'));
    const enabled = formData.get('enabled') === 'on';
    const channelId = String(formData.get('channelId') ?? '').trim() || null;

    const events: Record<string, boolean> = {};
    for (const type of ALL_EVENTS) {
      events[type] = formData.get(`event_${type}`) === 'on';
    }

    await serverFetch(`/admin/guilds/${gid}/logging-config`, {
      method: 'PUT',
      body: { enabled, channelId, events },
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
          <span className="text-sm font-medium">Enable audit logging</span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium">Log channel ID</label>
        <input
          name="channelId"
          defaultValue={cfg.channelId ?? ''}
          placeholder="123456789012345678"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-slate-500">
          Where audit messages are posted. Events are still stored in the database even without a channel set.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-300">Event types</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {ALL_EVENTS.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={`event_${type}`}
                defaultChecked={cfg.events[type] !== false}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
              />
              <span>{EVENT_LABEL[type]}</span>
            </label>
          ))}
        </div>
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
