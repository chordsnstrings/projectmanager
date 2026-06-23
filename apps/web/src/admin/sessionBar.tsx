import type { TimelineSession } from '@cadence/shared';
import { ACTIVITY_COLORS } from '../lib/activity';
import { fmtClock } from '../lib/format';
import { barGeom, pct, type TimeWindow } from './timeScale';

export interface SessionBarProps {
  session: TimelineSession;
  window: TimeWindow;
  /** flag ids on this session that are unresolved → render danger markers */
  flaggedIds: Set<string>;
  selected: boolean;
  onSelect: (session: TimelineSession) => void;
}

export default function SessionBar({ session, window: w, flaggedIds, selected, onSelect }: SessionBarProps) {
  const { left, width } = barGeom(session.startedAt, session.endedAt, w);
  const hasFlag = session.flagIds.some((id) => flaggedIds.has(id));

  return (
    <div className="absolute top-0 bottom-0" style={{ left: `${left}%`, width: `${width}%` }}>
      {/* the bar is a real button: focusable, keyboard- and touch-operable */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`session ${fmtClock(session.startedAt)} to ${session.endedAt ? fmtClock(session.endedAt) : 'now'}`}
        onClick={() => onSelect(session)}
        className={`relative block h-full w-full rounded-md overflow-hidden border cursor-pointer transition-[filter,box-shadow] hover:brightness-125 ${
          selected ? 'ring-2 ring-brass ring-offset-1 ring-offset-panel' : session.isOpen ? 'border-success/50' : 'border-hair2'
        } bg-surface`}
      >
        {session.segments.map((seg, i) => {
          const segGeom = barGeom(seg.startedAt, seg.endedAt, w);
          const relLeft = ((segGeom.left - left) / width) * 100;
          const relWidth = (segGeom.width / width) * 100;
          return (
            <span
              key={`${seg.startedAt}-${i}`}
              className="absolute top-0 bottom-0"
              style={{
                left: `${Math.max(0, relLeft)}%`,
                width: `${Math.max(0.5, relWidth)}%`,
                backgroundColor: ACTIVITY_COLORS[seg.type],
                opacity: seg.source === 'manual' ? 1 : 0.85,
              }}
              title={seg.type}
            />
          );
        })}
        {session.isOpen && (
          <span className="absolute right-0 top-0 bottom-0 w-0.5 bg-success" aria-hidden />
        )}
      </button>

      {/* commit dots along the bar */}
      {session.commits.map((c) => {
        const cLeft = ((pct(c.occurredAt, w) - left) / width) * 100;
        return (
          <span
            key={c.sha}
            className="pointer-events-none absolute -bottom-1.5 w-1.5 h-1.5 rounded-full bg-text border border-bg"
            style={{ left: `calc(${Math.min(100, Math.max(0, cLeft))}% - 3px)` }}
            aria-hidden
          />
        );
      })}

      {/* flag marker */}
      {hasFlag && (
        <span
          className="pointer-events-none absolute -top-1.5 left-0 w-2 h-2 rotate-45 bg-danger border border-bg"
          aria-hidden
        />
      )}

      {/* question marker (admin asked about this session) */}
      {session.questionIds.length > 0 && (
        <span
          className="pointer-events-none absolute -top-2 right-0 text-brass text-[10px] leading-none"
          aria-hidden
        >
          ?
        </span>
      )}
    </div>
  );
}
