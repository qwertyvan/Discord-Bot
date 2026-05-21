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
    const dmTemplate = String(formData.get('dmTemplate') ?? '').trim() || null;
    const milestoneTemplate = String(formData.get('milestoneTemplate') ?? '').trim() || null;
    const milestoneRaw = String(formData.get('milestoneEvery') ?? '').trim();
    const milestoneEvery = milestoneRaw ? Number(milestoneRaw) : null;
    const autoRoleIds = String(formData.get('autoRoleIds') ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    await serverFetch(`/admin/guilds/${gid}/welcome`, {
      method: 'PUT',
      body: {
        enabled,
        channelId,
        joinTemplate,
        leaveTemplate,
        dmTemplate,
        autoRoleIds,
        milestoneEvery,
        milestoneTemplate,
      },
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
            defaultChecked={config.enabled}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-discord"
          />
          <span className="text-sm font-medium">Send welcome / leave / milestone messages</span>
        </label>
      </div>

      <Field
        label="Channel ID"
        name="channelId"
        defaultValue={config.channelId ?? ''}
        placeholder="123456789012345678"
        mono
        help="Where channel-side join/leave/milestone messages are posted."
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
        textarea
      />

      <Field
        label="Join DM"
        name="dmTemplate"
        defaultValue={config.dmTemplate ?? ''}
        placeholder="Hey {username}, welcome to {server}! Check #rules to get started."
        help="Sent privately to the joining member. Users with DMs closed simply miss it."
        textarea
      />

      <Field
        label="Auto-role IDs"
        name="autoRoleIds"
        defaultValue={config.autoRoleIds.join(', ')}
        placeholder="role IDs (comma- or space-separated)"
        help="Assigned to every new member as soon as they join."
        mono
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Milestone every"
          name="milestoneEvery"
          defaultValue={config.milestoneEvery ?? ''}
          placeholder="100"
          help="Announce when memberCount crosses a multiple of this number."
        />
        <Field
          label="Milestone template"
          name="milestoneTemplate"
          defaultValue={config.milestoneTemplate ?? ''}
          placeholder="🎉 {server} just hit {memberCount} members!"
          textarea
        />
      </div>

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
  defaultValue: string | number;
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
