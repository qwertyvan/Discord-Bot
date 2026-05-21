import Link from 'next/link';
import type { Guild } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

export default async function GuildPickerPage() {
  const { guilds } = await serverFetch<{ guilds: Guild[] }>('/admin/guilds');

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Your servers</h1>
      <p className="mt-1 text-sm text-slate-400">
        Servers where you have <span className="text-slate-200">Manage Server</span> and the bot is
        present.
      </p>

      {guilds.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No servers found. Invite the bot to a server you administer, then refresh.
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {guilds.map((guild) => (
            <li key={guild.id}>
              <Link
                href={`/dashboard/${guild.id}`}
                className="block rounded-xl border border-slate-800 bg-slate-900/40 p-4 transition hover:border-slate-700 hover:bg-slate-900/70"
              >
                <div className="flex items-center gap-3">
                  {guild.iconUrl ? (
                    <img
                      src={guild.iconUrl}
                      alt=""
                      className="h-10 w-10 rounded-full border border-slate-700"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-sm text-slate-400">
                      {guild.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-100">{guild.name}</div>
                    <div className="text-xs text-slate-500">{guild.id}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
