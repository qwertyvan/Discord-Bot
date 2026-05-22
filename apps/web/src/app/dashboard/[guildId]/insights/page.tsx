import type { InsightsSummary } from '@discord-bot/shared';
import { serverFetch } from '@/lib/api';

export default async function InsightsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const summary = await serverFetch<InsightsSummary>(`/guilds/${guildId}/insights`, {
    query: { days: 30 },
  });

  const messageSeries = summary.series.map((p) => p.messages);
  const joinSeries = summary.series.map((p) => p.joins);
  const leaveSeries = summary.series.map((p) => p.leaves);
  const voiceSeries = summary.series.map((p) => p.voiceMinutes);

  const netMembers = summary.totals.joins - summary.totals.leaves;
  const voiceHours = (summary.totals.voiceMinutes / 60).toFixed(1);
  const topMax = Math.max(1, ...summary.topChannels.map((c) => c.messages));

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Messages (30d)" value={summary.totals.messages.toLocaleString()} />
        <Tile
          label="Net members (30d)"
          value={`${netMembers >= 0 ? '+' : ''}${netMembers.toLocaleString()}`}
          tone={netMembers >= 0 ? 'positive' : 'negative'}
        />
        <Tile
          label="Joins / leaves (30d)"
          value={`${summary.totals.joins.toLocaleString()} / ${summary.totals.leaves.toLocaleString()}`}
        />
        <Tile label="Voice hours (30d)" value={voiceHours} />
      </section>

      <Section title="Messages — last 30 days" empty={summary.totals.messages === 0}>
        <Sparkline values={messageSeries} stroke="#60a5fa" fill="rgba(96, 165, 250, 0.15)" />
        <SeriesAxis days={summary.series.map((s) => s.day)} />
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Joins vs leaves" empty={summary.totals.joins + summary.totals.leaves === 0}>
          <Sparkline values={joinSeries} stroke="#34d399" fill="rgba(52, 211, 153, 0.12)" />
          <Sparkline values={leaveSeries} stroke="#f87171" fill="rgba(248, 113, 113, 0.12)" />
          <SeriesAxis days={summary.series.map((s) => s.day)} />
          <div className="mt-2 flex gap-4 text-xs text-slate-400">
            <Legend color="#34d399" label="Joins" />
            <Legend color="#f87171" label="Leaves" />
          </div>
        </Section>

        <Section title="Voice minutes" empty={summary.totals.voiceMinutes === 0}>
          <Sparkline values={voiceSeries} stroke="#a78bfa" fill="rgba(167, 139, 250, 0.15)" />
          <SeriesAxis days={summary.series.map((s) => s.day)} />
        </Section>
      </div>

      <Section title="Top channels by messages (30d)" empty={summary.topChannels.length === 0}>
        <ul className="space-y-2">
          {summary.topChannels.map((c, i) => (
            <li key={c.channelId} className="flex items-center gap-3 text-sm">
              <span className="w-6 font-mono text-xs text-slate-500">#{i + 1}</span>
              <span className="w-44 truncate font-mono text-xs text-slate-300">{c.channelId}</span>
              <div className="flex-1">
                <div
                  className="h-3 rounded-sm bg-discord/70"
                  style={{ width: `${(c.messages / topMax) * 100}%` }}
                />
              </div>
              <span className="w-24 text-right text-slate-200">{c.messages.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'negative'
        ? 'text-red-400'
        : 'text-slate-100';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
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

// Inline SVG sparkline. Width is 100% (viewBox 0..len-1); height is fixed.
function Sparkline({ values, stroke, fill }: { values: number[]; stroke: string; fill: string }) {
  if (values.length === 0) return null;
  const width = Math.max(values.length - 1, 1);
  const height = 60;
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => {
    const x = i;
    const y = height - (v / max) * height;
    return `${x},${y.toFixed(2)}`;
  });
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block h-16 w-full"
      role="img"
    >
      <path d={areaPath} fill={fill} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function SeriesAxis({ days }: { days: string[] }) {
  if (days.length === 0) return null;
  const first = days[0];
  const last = days[days.length - 1];
  return (
    <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
      <span>{first}</span>
      <span>{last}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-3 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
