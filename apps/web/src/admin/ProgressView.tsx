import type { Progress } from '@cadence/shared';
import { fmtDuration } from '../lib/format';

function Stat({ label, value, tone = 'text-text' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-hair bg-surface/70 px-3 py-2 min-w-[96px]">
      <div className="label">{label}</div>
      <div className={`font-mono text-lg mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}

function weekLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "How far they've come": completion totals, weekly throughput, milestones, versions. */
export default function ProgressView({ data }: { data: Progress }) {
  const maxCompleted = Math.max(1, ...data.points.map((p) => p.completed));
  const maxActive = Math.max(1, ...data.points.map((p) => p.activeMinutes));
  const ratePct = Math.round(data.completionRate * 100);

  return (
    <section className="flex flex-col gap-5 animate-fade-in">
      {/* headline stats */}
      <div className="flex items-center gap-2 flex-wrap">
        <Stat label="completed" value={data.totalCompleted} tone="text-success" />
        <Stat label="completion" value={`${ratePct}%`} tone="text-brass" />
        <Stat label="in progress" value={data.openCount} />
        <Stat label="in review" value={data.inReviewCount} />
      </div>

      {/* completion-rate bar */}
      <div className="card p-4">
        <div className="label mb-2">overall completion</div>
        <div className="h-2.5 rounded-full bg-surface2 overflow-hidden">
          <div className="h-full bg-success rounded-full transition-[width] duration-700" style={{ width: `${ratePct}%` }} />
        </div>
        <div className="mt-1.5 font-mono text-[11px] text-text3">
          {data.totalCompleted} done · {data.openCount} remaining
        </div>
      </div>

      {/* weekly throughput */}
      <div className="card p-4">
        <div className="label mb-3">weekly throughput · last {data.points.length} weeks</div>
        <div className="flex items-end gap-1.5 h-28">
          {data.points.map((p) => (
            <div key={p.weekStart} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${p.completed} done · ${fmtDuration(p.activeMinutes)} active`}>
              <div className="w-full flex items-end justify-center gap-0.5 h-20">
                <div
                  className="w-2.5 rounded-t bg-success/80"
                  style={{ height: `${(p.completed / maxCompleted) * 100}%` }}
                />
                <div
                  className="w-2.5 rounded-t bg-brass/60"
                  style={{ height: `${(p.activeMinutes / maxActive) * 100}%` }}
                />
              </div>
              <span className="font-mono text-[9px] text-text3 truncate w-full text-center">{weekLabel(p.weekStart)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-4 font-mono text-[10px] text-text3">
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-success/80" />tasks completed</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-brass/60" />active time</span>
        </div>
      </div>

      {/* milestones */}
      {data.milestones.length > 0 && (
        <div className="card p-4">
          <div className="label mb-3">milestones</div>
          <ul className="flex flex-col gap-3">
            {data.milestones.map((m) => (
              <li key={m.title}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm text-text truncate tracking-tightish">{m.title}</span>
                  <span className="font-mono text-[11px] text-text3 shrink-0">
                    {m.done}/{m.total} · {m.pct}%
                    {m.dueOn ? ` · due ${weekLabel(m.dueOn)}` : ''}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface2 overflow-hidden">
                  <div className={`h-full rounded-full ${m.pct === 100 ? 'bg-success' : 'bg-brass'}`} style={{ width: `${m.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* versions */}
      {data.versions.length > 0 && (
        <div className="card p-4">
          <div className="label mb-2">latest versions</div>
          <ul className="flex flex-col gap-1.5">
            {data.versions.map((v) => (
              <li key={v.repoFullName} className="flex items-center justify-between gap-2 font-mono text-xs">
                <span className="text-text2 truncate">{v.repoFullName}</span>
                <span className="text-brass shrink-0">{v.version}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
