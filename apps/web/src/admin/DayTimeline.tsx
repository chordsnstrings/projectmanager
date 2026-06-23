import { useState } from 'react';
import type { DayTimeline as DayTimelineDTO, TimelineSession } from '@cadence/shared';
import { fmtDuration } from '../lib/format';
import { hourTicks, makeWindow, pct, type TimeWindow } from './timeScale';
import Lane from './lane';
import SessionDetail from './SessionDetail';

export interface DayTimelineProps {
  data: DayTimelineDTO;
}

function HeaderCard({
  label,
  value,
  tone = 'text-text',
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded border border-hair bg-surface px-3 py-2 min-w-[96px]">
      <div className="font-mono text-[10px] uppercase tracking-wide text-text3">{label}</div>
      <div className={`font-mono text-base ${tone}`}>{value}</div>
    </div>
  );
}

/**
 * Compute time spans (as percent ranges) where two or more sessions overlap,
 * across all lanes — drives the faint "concurrent" shaded bands (§9b).
 */
function concurrentBands(
  data: DayTimelineDTO,
  w: TimeWindow,
  nowMs: number = Date.now(),
): { left: number; width: number }[] {
  type Pt = { t: number; delta: number };
  const points: Pt[] = [];
  for (const lane of data.lanes) {
    for (const s of lane.sessions) {
      const a = new Date(s.startedAt).getTime();
      const b = s.endedAt ? new Date(s.endedAt).getTime() : nowMs;
      if (Number.isNaN(a) || Number.isNaN(b) || b <= a) continue;
      points.push({ t: a, delta: 1 });
      points.push({ t: b, delta: -1 });
    }
  }
  points.sort((p, q) => p.t - q.t || q.delta - p.delta);

  const bands: { left: number; width: number }[] = [];
  let depth = 0;
  let bandStart: number | null = null;
  for (const p of points) {
    const prevDepth = depth;
    depth += p.delta;
    if (prevDepth < 2 && depth >= 2) bandStart = p.t;
    else if (prevDepth >= 2 && depth < 2 && bandStart != null) {
      const left = pct(new Date(bandStart).toISOString(), w);
      const right = pct(new Date(p.t).toISOString(), w);
      if (right > left) bands.push({ left, width: right - left });
      bandStart = null;
    }
  }
  return bands;
}

export default function DayTimeline({ data }: DayTimelineProps) {
  const w = makeWindow(data.dayStart, data.dayEnd);
  const ticks = hourTicks(w);
  const bands = concurrentBands(data, w);
  const [selected, setSelected] = useState<TimelineSession | null>(null);
  const selectedLaneTitle =
    selected != null
      ? (data.lanes.find((l) => l.sessions.some((s) => s.id === selected.id))?.title ?? 'session')
      : '';
  // Unresolved flags drive the danger markers on bars.
  const flaggedIds = new Set(
    data.flags.filter((f) => f.status === 'open' && f.sessionId).map((f) => f.sessionId as string),
  );

  return (
    <section className="rounded-lg border border-hair bg-panel overflow-hidden">
      <header className="px-4 py-3 border-b border-hair flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-medium text-text">{data.githubLogin}</h2>
          <span className="font-mono text-xs text-text3">{data.date}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <HeaderCard label="active" value={fmtDuration(data.activeElapsedMinutes)} />
          <HeaderCard label="task hrs" value={fmtDuration(data.taskHoursMinutes)} />
          <HeaderCard label="sessions" value={data.sessionCount} />
          <HeaderCard
            label="flags"
            value={data.flags.filter((f) => f.status === 'open').length}
            tone={data.flags.some((f) => f.status === 'open') ? 'text-danger' : 'text-text3'}
          />
        </div>
      </header>

      {/* Horizontal scroll on small screens so the track stays legible. */}
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Axis */}
          <div className="flex items-stretch border-b border-hair bg-bg/40">
            <div className="w-40 sm:w-56 shrink-0 border-r border-hair px-4 py-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wide text-text3">task</span>
            </div>
            <div className="relative flex-1 min-w-0 py-1.5 px-2 h-7">
              {ticks.map((t) => (
                <span
                  key={t.left}
                  className="absolute top-1 font-mono text-[10px] text-text3 -translate-x-1/2"
                  style={{ left: `${t.left}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {/* Lanes with a concurrency band overlay aligned to the track region */}
          <div className="relative">
            {/* concurrency bands — offset by the label column */}
            <div className="pointer-events-none absolute inset-0 flex" aria-hidden>
              <div className="w-40 sm:w-56 shrink-0" />
              <div className="relative flex-1 min-w-0 px-2">
                <div className="relative h-full">
                  {bands.map((b, i) => (
                    <span
                      key={i}
                      className="absolute top-0 bottom-0 bg-brass/[0.06] border-x border-brass/10"
                      style={{ left: `${b.left}%`, width: `${b.width}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {data.lanes.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-text3">No sessions this day.</div>
            ) : (
              data.lanes.map((lane) => (
                <Lane
                  key={lane.taskId ?? lane.title}
                  lane={lane}
                  window={w}
                  flaggedIds={flaggedIds}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelected}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Selected-session detail — rendered in normal flow (no clipping). */}
      {selected && (
        <SessionDetail session={selected} laneTitle={selectedLaneTitle} onClose={() => setSelected(null)} />
      )}

      <p className="sm:hidden px-4 py-1.5 font-mono text-[10px] text-text3 border-t border-hair">
        swipe the timeline horizontally · tap a bar for detail
      </p>

      <footer className="px-4 py-2 border-t border-hair flex items-center gap-4 flex-wrap font-mono text-[10px] text-text3">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-text" aria-hidden /> commit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rotate-45 bg-danger" aria-hidden /> flag
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-2 bg-brass/[0.12] border-x border-brass/20" aria-hidden /> concurrent
        </span>
      </footer>
    </section>
  );
}
