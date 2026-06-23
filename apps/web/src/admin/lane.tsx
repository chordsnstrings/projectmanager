import type { TaskStatus, TimelineLane } from '@cadence/shared';
import { fmtDuration } from '../lib/format';
import { hourTicks, type TimeWindow } from './timeScale';
import SessionBar from './sessionBar';

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'assigned',
  in_progress: 'in progress',
  in_review: 'in review',
  done: 'done',
};

export interface LaneProps {
  lane: TimelineLane;
  window: TimeWindow;
  flaggedIds: Set<string>;
}

function Variance({ minutes }: { minutes: number | null }) {
  if (minutes == null) return <span className="text-text3">—</span>;
  if (minutes === 0) return <span className="text-text3">on est</span>;
  const over = minutes > 0;
  return (
    <span className={over ? 'text-danger' : 'text-success'}>
      {over ? '+' : '−'}
      {fmtDuration(Math.abs(minutes))}
    </span>
  );
}

export default function Lane({ lane, window: w, flaggedIds }: LaneProps) {
  const ticks = hourTicks(w);
  return (
    <div className="flex items-stretch border-b border-hair last:border-b-0">
      {/* lane label */}
      <div className="w-56 shrink-0 px-4 py-3 border-r border-hair">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text3">{lane.origin}</span>
          {lane.reopenCount > 0 && (
            <span className="font-mono text-[11px] text-danger/80">↻{lane.reopenCount}</span>
          )}
        </div>
        <div className="text-sm text-text truncate">{lane.title}</div>
        <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-text3 flex-wrap">
          <span>{STATUS_LABEL[lane.status]}</span>
          <span>{fmtDuration(lane.actualMinutes)}</span>
          {lane.estimateMinutes != null && (
            <span>/ est {fmtDuration(lane.estimateMinutes)}</span>
          )}
          <Variance minutes={lane.varianceMinutes} />
        </div>
      </div>

      {/* track */}
      <div className="relative flex-1 min-w-0 py-4 px-2">
        {/* hour gridlines */}
        {ticks.map((t) => (
          <span
            key={t.left}
            className="absolute top-0 bottom-0 w-px bg-hair"
            style={{ left: `${t.left}%` }}
            aria-hidden
          />
        ))}

        {/* the bars region (absolute children) */}
        <div className="relative h-6">
          {lane.sessions.map((s) => (
            <SessionBar key={s.id} session={s} window={w} flaggedIds={flaggedIds} />
          ))}
        </div>
      </div>
    </div>
  );
}
