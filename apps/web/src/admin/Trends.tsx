import type { ActivityType, TrendPoint, Trends as TrendsData } from '@cadence/shared';
import { ACTIVITY_COLORS } from '../lib/activity';
import { fmtDuration } from '../lib/format';

// ── helpers ──────────────────────────────────────────────────────────────────

/** ISO week-start → "Jun 23". */
function fmtWeek(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const ACTIVITY_ORDER: ActivityType[] = ['coding', 'debugging', 'research', 'agent', 'review'];

const VB_W = 240;
const VB_H = 96;
const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 8;
const PAD_B = 8;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

function xFor(i: number, n: number): number {
  if (n <= 1) return PAD_L + PLOT_W / 2;
  return PAD_L + (PLOT_W * i) / (n - 1);
}

function bandFor(i: number, n: number): { x: number; w: number } {
  const band = n > 0 ? PLOT_W / n : PLOT_W;
  const inner = band * 0.62;
  return { x: PAD_L + band * i + (band - inner) / 2, w: inner };
}

function yFor(v: number, min: number, max: number): number {
  if (max <= min) return PAD_T + PLOT_H;
  const t = (v - min) / (max - min);
  return PAD_T + PLOT_H * (1 - t);
}

/** True if every point's value for the metric is null/missing. */
function allNull(points: TrendPoint[], pick: (p: TrendPoint) => number | null): boolean {
  return points.every((p) => pick(p) == null);
}

// ── shared chrome ─────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hair bg-panel p-3 flex flex-col gap-2 min-w-0">
      <h3 className="font-mono text-[10px] uppercase tracking-wide text-text3">{title}</h3>
      {children}
    </div>
  );
}

function NoData() {
  return (
    <div className="h-24 flex items-center justify-center font-mono text-[11px] text-text3">
      no data yet
    </div>
  );
}

function WeekAxis({ points }: { points: TrendPoint[] }) {
  return (
    <div className="flex justify-between font-mono text-[9px] text-text3 gap-1">
      {points.map((p, i) => (
        <span key={`${p.weekStart}-${i}`} className="truncate">
          {fmtWeek(p.weekStart)}
        </span>
      ))}
    </div>
  );
}

// ── charts ─────────────────────────────────────────────────────────────────────

function EstimateAccuracyChart({ points }: { points: TrendPoint[] }) {
  if (allNull(points, (p) => p.estimateAccuracy)) return <NoData />;
  const vals = points.map((p) => p.estimateAccuracy);
  const numeric = vals.filter((v): v is number => v != null);
  const maxVal = Math.max(2, ...numeric);
  const minVal = 0;
  const n = points.length;

  const refY = yFor(1, minVal, maxVal);

  // Latest non-null value, for the label.
  let latest: number | null = null;
  for (let i = vals.length - 1; i >= 0; i -= 1) {
    const v = vals[i];
    if (v != null) {
      latest = v;
      break;
    }
  }

  const segments: { x1: number; y1: number; x2: number; y2: number; over: boolean }[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = vals[i];
    const b = vals[i + 1];
    if (a == null || b == null) continue;
    segments.push({
      x1: xFor(i, n),
      y1: yFor(a, minVal, maxVal),
      x2: xFor(i + 1, n),
      y2: yFor(b, minVal, maxVal),
      over: (a + b) / 2 > 1,
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-xs text-text2">on-estimate = 1.0×</span>
        <span
          className={`font-mono text-sm ${
            latest == null ? 'text-text3' : latest > 1 ? 'text-danger' : 'text-success'
          }`}
        >
          {latest == null ? '—' : `${latest.toFixed(1)}×`}
        </span>
      </div>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full" preserveAspectRatio="none">
        <line
          x1={PAD_L}
          y1={refY}
          x2={VB_W - PAD_R}
          y2={refY}
          stroke="#9aa0aa"
          strokeWidth={0.5}
          strokeDasharray="3 3"
        />
        {segments.map((s, i) => (
          <line
            key={i}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke={s.over ? '#ef5b5b' : '#5bc07a'}
            strokeWidth={1.5}
          />
        ))}
        {points.map((p, i) =>
          p.estimateAccuracy == null ? null : (
            <circle
              key={`${p.weekStart}-${i}`}
              cx={xFor(i, n)}
              cy={yFor(p.estimateAccuracy, minVal, maxVal)}
              r={1.6}
              fill={p.estimateAccuracy > 1 ? '#ef5b5b' : '#5bc07a'}
            />
          ),
        )}
      </svg>
      <WeekAxis points={points} />
    </div>
  );
}

function ReworkRateChart({ points }: { points: TrendPoint[] }) {
  if (allNull(points, (p) => p.reworkRate)) return <NoData />;
  const n = points.length;
  const max = 1; // 0..1 ratio rendered as %

  let latest: number | null = null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i];
    if (p && p.reworkRate != null) {
      latest = p.reworkRate;
      break;
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-end">
        <span className="font-mono text-sm text-text2">
          {latest == null ? '—' : `${Math.round(latest * 100)}%`}
        </span>
      </div>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full" preserveAspectRatio="none">
        {points.map((p, i) => {
          const v = p.reworkRate;
          if (v == null) return null;
          const { x, w } = bandFor(i, n);
          const y = yFor(v, 0, max);
          const h = PAD_T + PLOT_H - y;
          return (
            <rect
              key={`${p.weekStart}-${i}`}
              x={x}
              y={y}
              width={w}
              height={Math.max(0.5, h)}
              fill="#f0a93b"
              opacity={0.85}
            >
              <title>{`${Math.round(v * 100)}%`}</title>
            </rect>
          );
        })}
      </svg>
      <WeekAxis points={points} />
    </div>
  );
}

function FlagsChart({ points }: { points: TrendPoint[] }) {
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.flagCount));
  const latest = points.length > 0 ? points[points.length - 1]?.flagCount ?? 0 : 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-end">
        <span className="font-mono text-sm text-text2">{latest}</span>
      </div>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full" preserveAspectRatio="none">
        {points.map((p, i) => {
          const { x, w } = bandFor(i, n);
          const y = yFor(p.flagCount, 0, max);
          const h = PAD_T + PLOT_H - y;
          return (
            <rect
              key={`${p.weekStart}-${i}`}
              x={x}
              y={p.flagCount === 0 ? PAD_T + PLOT_H - 0.5 : y}
              width={w}
              height={p.flagCount === 0 ? 0.5 : Math.max(0.5, h)}
              fill="#ef5b5b"
              opacity={p.flagCount === 0 ? 0.25 : 0.8}
            >
              <title>{`${p.flagCount} flags`}</title>
            </rect>
          );
        })}
      </svg>
      <WeekAxis points={points} />
    </div>
  );
}

function CycleTouchChart({ points }: { points: TrendPoint[] }) {
  const noCycle = allNull(points, (p) => p.cycleTimeMinutes);
  const noTouch = allNull(points, (p) => p.touchTimeMinutes);
  if (noCycle && noTouch) return <NoData />;

  const n = points.length;
  const numeric: number[] = [];
  for (const p of points) {
    if (p.cycleTimeMinutes != null) numeric.push(p.cycleTimeMinutes);
    if (p.touchTimeMinutes != null) numeric.push(p.touchTimeMinutes);
  }
  const max = Math.max(1, ...numeric);

  function line(pick: (p: TrendPoint) => number | null, color: string) {
    const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < n - 1; i += 1) {
      const cur = points[i];
      const nxt = points[i + 1];
      if (!cur || !nxt) continue;
      const a = pick(cur);
      const b = pick(nxt);
      if (a == null || b == null) continue;
      segs.push({
        x1: xFor(i, n),
        y1: yFor(a, 0, max),
        x2: xFor(i + 1, n),
        y2: yFor(b, 0, max),
      });
    }
    return segs.map((s, i) => (
      <line key={`${color}-${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color} strokeWidth={1.5} />
    ));
  }

  let latestCycle: number | null = null;
  let latestTouch: number | null = null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i];
    if (!p) continue;
    if (latestCycle == null && p.cycleTimeMinutes != null) latestCycle = p.cycleTimeMinutes;
    if (latestTouch == null && p.touchTimeMinutes != null) latestTouch = p.touchTimeMinutes;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px]">
        <span className="flex items-center gap-1 text-text2">
          <span className="inline-block w-2 h-0.5" style={{ backgroundColor: '#4c9aea' }} aria-hidden />
          cycle {latestCycle == null ? '—' : fmtDuration(latestCycle)}
        </span>
        <span className="flex items-center gap-1 text-text2">
          <span className="inline-block w-2 h-0.5" style={{ backgroundColor: '#c8a96a' }} aria-hidden />
          touch {latestTouch == null ? '—' : fmtDuration(latestTouch)}
        </span>
      </div>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full" preserveAspectRatio="none">
        {line((p) => p.cycleTimeMinutes, '#4c9aea')}
        {line((p) => p.touchTimeMinutes, '#c8a96a')}
      </svg>
      <WeekAxis points={points} />
    </div>
  );
}

function ActivityMixChart({ points }: { points: TrendPoint[] }) {
  const hasAny = points.some((p) => ACTIVITY_ORDER.some((k) => (p.activityMix[k] ?? 0) > 0));
  if (!hasAny) return <NoData />;

  const n = points.length;
  const band = n > 0 ? PLOT_W / n : PLOT_W;
  const barW = band * 0.62;

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full" preserveAspectRatio="none">
        {points.map((p, i) => {
          const total = ACTIVITY_ORDER.reduce((sum, k) => sum + (p.activityMix[k] ?? 0), 0);
          const x = PAD_L + band * i + (band - barW) / 2;
          if (total <= 0) {
            return (
              <rect
                key={`${p.weekStart}-${i}`}
                x={x}
                y={PAD_T}
                width={barW}
                height={PLOT_H}
                fill="#21252e"
              />
            );
          }
          let acc = 0;
          return (
            <g key={`${p.weekStart}-${i}`}>
              {ACTIVITY_ORDER.map((k) => {
                const v = p.activityMix[k] ?? 0;
                if (v <= 0) return null;
                const frac = v / total;
                const h = PLOT_H * frac;
                const y = PAD_T + PLOT_H - acc - h;
                acc += h;
                return (
                  <rect key={k} x={x} y={y} width={barW} height={h} fill={ACTIVITY_COLORS[k]}>
                    <title>{`${k}: ${fmtDuration(v)}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      <WeekAxis points={points} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-text2">
        {ACTIVITY_ORDER.map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-[2px]"
              style={{ backgroundColor: ACTIVITY_COLORS[k] }}
              aria-hidden
            />
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── root ───────────────────────────────────────────────────────────────────────

export default function Trends({ data }: { data: TrendsData }) {
  const points = data.points;

  if (points.length === 0) {
    return (
      <section className="rounded-lg border border-hair bg-panel p-8 text-center text-sm text-text3">
        No trend data yet.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-text">Trends</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <Card title="Estimate accuracy">
          <EstimateAccuracyChart points={points} />
        </Card>
        <Card title="Rework rate">
          <ReworkRateChart points={points} />
        </Card>
        <Card title="Flags / week">
          <FlagsChart points={points} />
        </Card>
        <Card title="Cycle vs touch">
          <CycleTouchChart points={points} />
        </Card>
        <Card title="Activity mix">
          <ActivityMixChart points={points} />
        </Card>
      </div>
    </section>
  );
}
