import type { BlockerKey, PulseInsights, PulseMember } from '@cadence/shared';

const BLOCKER_LABEL: Record<BlockerKey, string> = {
  review: 'Waiting on review',
  requirements: 'Unclear requirements',
  bug: 'Stuck on a bug',
  meetings: 'Meetings / switching',
  none: 'Nothing',
  other: 'Something else',
};

function fmtMinutes(min: number): string {
  if (min <= 0) return '0m';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}

function Avatar({ m }: { m: PulseMember }) {
  if (m.avatarUrl) return <img src={m.avatarUrl} alt="" className="w-6 h-6 rounded-full border border-hair shrink-0" />;
  const initial = (m.name ?? m.githubLogin).slice(0, 1).toUpperCase();
  return (
    <span className="w-6 h-6 rounded-full border border-hair2 bg-surface2 inline-flex items-center justify-center text-[11px] text-text2 shrink-0">
      {initial}
    </span>
  );
}

/** felt-vs-measured: + = feels better than output (watch for over-confidence),
 *  − = output beats how they feel (watch for burnout / under-recognition). */
function GapBadge({ gap }: { gap: number | null }) {
  if (gap == null) return <span className="font-mono text-[12px] text-text3">—</span>;
  const tone = Math.abs(gap) < 0.6 ? 'text-text3' : gap > 0 ? 'text-activity-debugging' : 'text-activity-research';
  const sign = gap > 0 ? '+' : '';
  return (
    <span className={`font-mono text-[12px] ${tone}`} title="self-rating vs measured output (z-score)">
      {sign}
      {gap.toFixed(1)}
    </span>
  );
}

function Sparkline({ points }: { points: { weekStart: string; avgProductivity: number | null; responses: number }[] }) {
  const vals = points.map((p) => p.avgProductivity).filter((n): n is number => n != null);
  if (vals.length < 2) return <span className="font-mono text-[12px] text-text3">not enough data yet</span>;
  const w = 220;
  const h = 36;
  const max = 5;
  const min = 1;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const y = (v: number) => h - ((v - min) / (max - min)) * h;
  const path = points
    .map((p, i) => (p.avgProductivity == null ? null : `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p.avgProductivity).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  const last = points[points.length - 1]!;
  return (
    <div className="flex items-center gap-3">
      <svg width={w} height={h} className="overflow-visible">
        <path d={path} fill="none" stroke="#d8b67c" strokeWidth="1.5" />
        {points.map((p, i) =>
          p.avgProductivity == null ? null : (
            <circle key={i} cx={i * step} cy={y(p.avgProductivity)} r="2" fill="#d8b67c" />
          ),
        )}
      </svg>
      <span className="font-mono text-[12px] text-text2">
        {last.avgProductivity?.toFixed(1)}
        <span className="text-text3">/5</span>
      </span>
    </div>
  );
}

export default function PulsePanel({ data }: { data: PulseInsights | null }) {
  if (!data) {
    return <div className="card p-6 text-sm text-text3 animate-fade-in">Loading pulse…</div>;
  }
  const responders = data.members.filter((m) => m.responses > 0);
  const silent = data.members.filter((m) => m.responses === 0);
  const blockerMax = Math.max(1, ...data.blockers.map((b) => b.count));
  const carryTotal = data.carryover.blocked + data.carryover.dropping + data.carryover.onTrack;

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <p className="text-[12px] text-text3 -mb-1">
        How the team feels vs. what the clock measured — last {data.rangeDays} days of morning check-ins.
      </p>

      {/* Felt vs measured, per member */}
      <section className="card overflow-hidden">
        <header className="px-4 sm:px-5 py-3.5 border-b border-hair flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text tracking-tightish">Felt vs measured</h2>
          <span className="font-mono text-xs text-text3">{responders.length} responding</span>
        </header>
        {responders.length === 0 ? (
          <div className="px-5 py-6 text-sm text-text3">No check-ins recorded yet.</div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-text3">
                <th className="font-normal text-[11px] uppercase tracking-wide px-4 sm:px-5 py-2">Member</th>
                <th className="font-normal text-[11px] uppercase tracking-wide px-2 py-2 text-right">Felt</th>
                <th className="font-normal text-[11px] uppercase tracking-wide px-2 py-2 text-right">Measured</th>
                <th className="font-normal text-[11px] uppercase tracking-wide px-2 py-2 text-right">Gap</th>
                <th className="font-normal text-[11px] uppercase tracking-wide px-4 sm:px-5 py-2">Last blocker</th>
              </tr>
            </thead>
            <tbody>
              {responders.map((m) => (
                <tr key={m.userId} className="border-t border-hair">
                  <td className="px-4 sm:px-5 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar m={m} />
                      <span className="text-[13px] text-text2 truncate">{m.name ?? m.githubLogin}</span>
                      <span className="font-mono text-[10px] text-text3">{m.responses}×</span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-[12px] text-text2">
                    {m.avgProductivity != null ? `${m.avgProductivity.toFixed(1)}/5` : '—'}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-[12px] text-text2">{fmtMinutes(m.avgActiveMinutes)}</td>
                  <td className="px-2 py-2.5 text-right">
                    <GapBadge gap={m.gap} />
                  </td>
                  <td className="px-4 sm:px-5 py-2.5 font-mono text-[11px] text-text3 truncate">
                    {m.lastBlocker && m.lastBlocker !== 'none' ? BLOCKER_LABEL[m.lastBlocker] : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {silent.length > 0 && (
          <div className="px-4 sm:px-5 py-2.5 border-t border-hair font-mono text-[11px] text-text3">
            no check-ins: {silent.map((m) => m.githubLogin).join(', ')}
          </div>
        )}
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Sentiment trend */}
        <section className="card overflow-hidden">
          <header className="px-4 sm:px-5 py-3.5 border-b border-hair">
            <h2 className="text-sm font-semibold text-text tracking-tightish">Sentiment trend</h2>
          </header>
          <div className="px-4 sm:px-5 py-4">
            <Sparkline points={data.sentiment} />
            <p className="mt-2 font-mono text-[11px] text-text3">avg self-rating, by week</p>
          </div>
        </section>

        {/* Carry-over */}
        <section className="card overflow-hidden">
          <header className="px-4 sm:px-5 py-3.5 border-b border-hair">
            <h2 className="text-sm font-semibold text-text tracking-tightish">Open work right now</h2>
          </header>
          <div className="px-4 sm:px-5 py-4">
            {carryTotal === 0 ? (
              <p className="text-sm text-text3">No carry-over reported.</p>
            ) : (
              <>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-surface2">
                  {data.carryover.onTrack > 0 && (
                    <div className="bg-success" style={{ width: `${(data.carryover.onTrack / carryTotal) * 100}%` }} />
                  )}
                  {data.carryover.blocked > 0 && (
                    <div className="bg-danger" style={{ width: `${(data.carryover.blocked / carryTotal) * 100}%` }} />
                  )}
                  {data.carryover.dropping > 0 && (
                    <div className="bg-text3" style={{ width: `${(data.carryover.dropping / carryTotal) * 100}%` }} />
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
                  <span className="text-success">{data.carryover.onTrack} on track</span>
                  <span className="text-danger">{data.carryover.blocked} blocked</span>
                  <span className="text-text3">{data.carryover.dropping} dropping</span>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Blocker heatmap */}
      <section className="card overflow-hidden">
        <header className="px-4 sm:px-5 py-3.5 border-b border-hair">
          <h2 className="text-sm font-semibold text-text tracking-tightish">Blockers</h2>
        </header>
        <div className="px-4 sm:px-5 py-4 flex flex-col gap-2">
          {data.blockers.filter((b) => b.key !== 'none').length === 0 ? (
            <p className="text-sm text-text3">No blockers reported.</p>
          ) : (
            data.blockers
              .filter((b) => b.key !== 'none')
              .map((b) => (
                <div key={b.key} className="flex items-center gap-3">
                  <span className="text-[12px] text-text2 w-40 shrink-0 truncate">{BLOCKER_LABEL[b.key]}</span>
                  <div className="flex-1 h-2 rounded-full bg-surface2 overflow-hidden">
                    <div className="h-full bg-activity-debugging/70" style={{ width: `${(b.count / blockerMax) * 100}%` }} />
                  </div>
                  <span className="font-mono text-[12px] text-text3 w-6 text-right">{b.count}</span>
                </div>
              ))
          )}
        </div>
      </section>
    </div>
  );
}
