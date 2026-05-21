import { serverFetch } from '@/lib/api';

interface TrendRow {
  date: string;
  joins?: number;
  leaves?: number;
  type?: string;
  count?: number;
}

interface HeatmapRow {
  channelId: string;
  hour: number;
  count: number;
}

interface TopRow {
  userId: string;
  count: number;
}

export default async function StatsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const [growth, modTrend, top, heatmap] = await Promise.all([
    serverFetch<{ trend: TrendRow[] }>(`/admin/guilds/${guildId}/stats/member-growth`, {
      query: { days: 30 },
    }),
    serverFetch<{ trend: TrendRow[] }>(`/admin/guilds/${guildId}/stats/mod-actions-trend`, {
      query: { days: 30 },
    }),
    serverFetch<{ top: TopRow[] }>(`/admin/guilds/${guildId}/stats/top-targets`, {
      query: { days: 30, limit: 10 },
    }),
    serverFetch<{ heatmap: HeatmapRow[] }>(`/admin/guilds/${guildId}/stats/channel-heatmap`, {
      query: { days: 7 },
    }),
  ]);

  const channelTotals = new Map<string, number>();
  const channelByHour = new Map<string, number[]>();
  for (const row of heatmap.heatmap) {
    channelTotals.set(row.channelId, (channelTotals.get(row.channelId) ?? 0) + row.count);
    const hours = channelByHour.get(row.channelId) ?? new Array<number>(24).fill(0);
    hours[row.hour] = (hours[row.hour] ?? 0) + row.count;
    channelByHour.set(row.channelId, hours);
  }
  const topChannels = [...channelTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const maxHeat = Math.max(1, ...heatmap.heatmap.map((r) => r.count));

  return (
    <div className="space-y-10">
      <Section title="Member growth — last 30 days" empty={growth.trend.length === 0}>
        <DiffBarChart
          rows={growth.trend.map((r) => ({
            date: r.date,
            positive: r.joins ?? 0,
            negative: r.leaves ?? 0,
          }))}
        />
      </Section>

      <Section title="Mod actions — last 30 days" empty={modTrend.trend.length === 0}>
        <StackedBarChart
          rows={modTrend.trend.map((r) => ({
            date: r.date,
            type: r.type ?? 'OTHER',
            count: r.count ?? 0,
          }))}
        />
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Top moderation targets — last 30 days" empty={top.top.length === 0}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-800">
              {top.top.map((row, i) => (
                <tr key={row.userId} className="px-4 py-2">
                  <td className="py-1.5 text-xs text-slate-500">#{i + 1}</td>
                  <td className="font-mono text-xs text-slate-300">{row.userId}</td>
                  <td className="text-right text-slate-200">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Channel activity (last 7 days)" empty={heatmap.heatmap.length === 0}>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-slate-400">Channel</th>
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} className="px-1 py-1 text-center text-slate-500">
                      {h}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right text-slate-400">Total</th>
                </tr>
              </thead>
              <tbody>
                {topChannels.map(([channelId, total]) => {
                  const hours = channelByHour.get(channelId) ?? new Array<number>(24).fill(0);
                  return (
                    <tr key={channelId}>
                      <td className="px-2 py-1 font-mono text-[10px] text-slate-400">
                        {channelId.slice(0, 8)}…
                      </td>
                      {hours.map((n, i) => {
                        const intensity = n / maxHeat;
                        const bg = `rgba(88, 101, 242, ${0.05 + 0.95 * intensity})`;
                        return (
                          <td
                            key={i}
                            className="h-5 w-5 border border-slate-900 text-center text-[10px]"
                            style={{ backgroundColor: bg }}
                            title={`${n} msgs`}
                          >
                            {n > 0 ? '' : ''}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-right text-slate-200">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
      {empty ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          No data yet.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">{children}</div>
      )}
    </section>
  );
}

function DiffBarChart({
  rows,
}: {
  rows: Array<{ date: string; positive: number; negative: number }>;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.positive, r.negative)));
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.date} className="flex items-center gap-2 text-xs">
          <span className="w-20 font-mono text-[10px] text-slate-500">{r.date}</span>
          <div className="flex-1">
            <div className="flex items-center gap-px">
              <div
                className="h-3 bg-emerald-500/60"
                style={{ width: `${(r.positive / max) * 50}%` }}
              />
              <div
                className="h-3 bg-red-500/60"
                style={{ width: `${(r.negative / max) * 50}%` }}
              />
            </div>
          </div>
          <span className="w-24 text-right text-slate-400">
            +{r.positive} / −{r.negative}
          </span>
        </div>
      ))}
    </div>
  );
}

function StackedBarChart({
  rows,
}: {
  rows: Array<{ date: string; type: string; count: number }>;
}) {
  // Aggregate by date.
  const byDate = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const day = byDate.get(r.date) ?? {};
    day[r.type] = (day[r.type] ?? 0) + r.count;
    byDate.set(r.date, day);
  }
  const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...days.map(([, d]) => Object.values(d).reduce((s, n) => s + n, 0)));
  const palette: Record<string, string> = {
    WARN: 'bg-yellow-500/70',
    KICK: 'bg-orange-500/70',
    BAN: 'bg-red-500/70',
    SOFTBAN: 'bg-red-500/40',
    TIMEOUT: 'bg-amber-400/70',
    MUTE: 'bg-amber-400/40',
    UNBAN: 'bg-emerald-500/70',
    UNTIMEOUT: 'bg-emerald-500/40',
    UNMUTE: 'bg-emerald-500/40',
    NOTE: 'bg-blue-500/70',
  };

  return (
    <div className="space-y-1">
      {days.map(([date, day]) => {
        const total = Object.values(day).reduce((s, n) => s + n, 0);
        return (
          <div key={date} className="flex items-center gap-2 text-xs">
            <span className="w-20 font-mono text-[10px] text-slate-500">{date}</span>
            <div className="flex h-3 flex-1 overflow-hidden rounded-sm bg-slate-900">
              {Object.entries(day).map(([type, count]) => (
                <div
                  key={type}
                  className={`${palette[type] ?? 'bg-slate-500/70'} h-full`}
                  style={{ width: `${(count / max) * 100}%` }}
                  title={`${type}: ${count}`}
                />
              ))}
            </div>
            <span className="w-12 text-right text-slate-400">{total}</span>
          </div>
        );
      })}
    </div>
  );
}
