import Link from 'next/link';
import type { Guild } from '@discord-bot/shared';
import { ApiError, serverFetch } from '@/lib/api';
import { notFound } from 'next/navigation';

export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;

  let guild: Guild | null = null;
  try {
    const { guilds } = await serverFetch<{ guilds: Guild[] }>('/admin/guilds');
    guild = guilds.find((g) => g.id === guildId) ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) notFound();
    throw err;
  }
  if (!guild) notFound();

  const base = `/dashboard/${guildId}`;
  const tabs = [
    { href: base, label: 'Overview' },
    { href: `${base}/mod-log`, label: 'Mod log' },
    { href: `${base}/audit-log`, label: 'Audit log' },
    { href: `${base}/automod`, label: 'Automod' },
    { href: `${base}/welcome`, label: 'Welcome' },
    { href: `${base}/verification`, label: 'Verify' },
    { href: `${base}/reaction-roles`, label: 'Role panels' },
    { href: `${base}/leveling`, label: 'Leveling' },
    { href: `${base}/economy`, label: 'Economy' },
    { href: `${base}/logging`, label: 'Logging' },
    { href: `${base}/policy`, label: 'Policy' },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        {guild.iconUrl ? (
          <img
            src={guild.iconUrl}
            alt=""
            className="h-12 w-12 rounded-full border border-slate-700"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-base text-slate-400">
            {guild.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{guild.name}</h1>
          <p className="text-xs text-slate-500">{guild.id}</p>
        </div>
      </div>

      <nav className="mb-6 flex gap-1 border-b border-slate-800">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-slate-300 transition hover:border-slate-700 hover:text-slate-100"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
