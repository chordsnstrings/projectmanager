import type { TaskStatus, TimelineLane, TimelineSession } from '@cadence/shared';
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
  /** IANA tz the day is expressed in (axis labels + bar tooltips) */
  tz?: string;
  flaggedIds: Set<string>;
  selectedId: string | null;
  onSelect: (session: TimelineSession) => void;
  /** click the task label → open its detail (selects the lane's latest session) */
  onSelectLane: (lane: TimelineLane) => void;
  /** click the lane "ask" button → open its detail with the question input ready */
  onAskLane: (lane: TimelineLane) => void;
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

export default function Lane({ lane, window: w, tz, flaggedIds, selectedId, onSelect, onSelectLane, onAskLane }: LaneProps) {
  const ticks = hourTicks(w, tz);
  const canAsk = lane.taskId != null; // off-task lanes have no task to ask about
  return (
    <div className="flex items-stretch border-b border-hair last:border-b-0 hover:bg-surface/20 transition-colors">
      {/* lane label — clickable: opens the task's detail (and the ask affordance) */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectLane(lane)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectLane(lane);
          }
        }}
        title="open this task’s detail"
        className="group w-40 sm:w-56 shrink-0 px-4 py-3.5 border-r border-hair cursor-pointer hover:bg-surface/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brass/50"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text3">{lane.origin}</span>
          {lane.reopenCount > 0 && (
            <span className="font-mono text-[11px] text-danger/80">↻{lane.reopenCount}</span>
          )}
          {canAsk && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAskLane(lane);
              }}
              title="ask a question about this task"
              className="ml-auto font-mono text-[11px] text-brass/80 hover:text-brass opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            >
              ask…
            </button>
          )}
        </div>
        <div className="text-sm text-text truncate mt-0.5 tracking-tightish">{lane.title}</div>
        <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-text3 flex-wrap">
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
            <SessionBar
              key={s.id}
              session={s}
              window={w}
              tz={tz}
              flaggedIds={flaggedIds}
              selected={s.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
