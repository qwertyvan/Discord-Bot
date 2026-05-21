import type { GuildStats } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

export default async function GuildOverviewPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const stats = await serverFetch<GuildStats>(`/admin/guilds/${guildId}/stats`);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Total warnings" value={stats.warningCount} />
      <StatCard label="Warnings (last 7 days)" value={stats.warningsLast7d} />
      <StatCard
        label="Welcome messages"
        value={stats.welcomeEnabled ? 'On' : 'Off'}
        tone={stats.welcomeEnabled ? 'positive' : 'muted'}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'positive' | 'muted';
}) {
  const toneClass =
    tone === 'positive' ? 'text-emerald-400' : tone === 'muted' ? 'text-slate-500' : 'text-slate-100';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
