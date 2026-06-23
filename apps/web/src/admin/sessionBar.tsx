import { useState } from 'react';
import type { CommitDTO, TimelineSession } from '@cadence/shared';
import { ACTIVITY_COLORS } from '../lib/activity';
import { fmtClock, fmtDuration } from '../lib/format';
import { barGeom, pct, type TimeWindow } from './timeScale';

export interface SessionBarProps {
  session: TimelineSession;
  window: TimeWindow;
  /** flag ids on this session that are unresolved → render danger markers */
  flaggedIds: Set<string>;
}

/** Activity breakdown (minutes) computed from a session's segments. */
function activityBreakdown(session: TimelineSession): { type: string; minutes: number }[] {
  const totals = new Map<string, number>();
  for (const seg of session.segments) {
    const a = new Date(seg.startedAt).getTime();
    const b = new Date(seg.endedAt).getTime();
    const mins = Math.max(0, (b - a) / 60_000);
    totals.set(seg.type, (totals.get(seg.type) ?? 0) + mins);
  }
  return [...totals.entries()].map(([type, minutes]) => ({ type, minutes }));
}

function Commit({ c }: { c: CommitDTO }) {
  return (
    <li className="font-mono text-[11px] text-text2 flex gap-2">
      <span className="text-text3">{fmtClock(c.occurredAt)}</span>
      <span className="text-text2">{c.sha.slice(0, 7)}</span>
      <span className="truncate">{c.message}</span>
    </li>
  );
}

export default function SessionBar({ session, window: w, flaggedIds }: SessionBarProps) {
  // Tap/click toggles the detail popover so it works on touch + keyboard, not
  // just hover. An outside-tap backdrop closes it.
  const [open, setOpen] = useState(false);
  const { left, width } = barGeom(session.startedAt, session.endedAt, w);
  const hasFlag = session.flagIds.some((id) => flaggedIds.has(id));
  const breakdown = activityBreakdown(session);

  return (
    <div
      className="absolute top-0 bottom-0"
      style={{ left: `${left}%`, width: `${width}%` }}
    >
      {/* the bar is a real button: focusable, keyboard- and touch-operable */}
      <button
        type="button"
        aria-expanded={open}
        aria-label={`session ${fmtClock(session.startedAt)} to ${session.endedAt ? fmtClock(session.endedAt) : 'now'}`}
        onClick={() => setOpen((o) => !o)}
        className={`relative block h-full w-full rounded-sm overflow-hidden border cursor-pointer ${
          session.isOpen ? 'border-success/50' : 'border-hair2'
        } bg-surface hover:brightness-125`}
      >
        {/* activity segments, absolutely positioned within the bar */}
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

      {/* detail popover (tap to open/close; backdrop closes on outside tap) */}
      {open && (
        <>
          <button
            type="button"
            aria-label="close detail"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
            tabIndex={-1}
          />
          <div className="absolute z-20 top-full mt-2 left-0 w-72 max-w-[80vw] rounded-lg border border-hair2 bg-surface2 p-3 text-left shadow-none">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="font-mono text-xs text-text2">
                {fmtClock(session.startedAt)}–
                {session.endedAt ? fmtClock(session.endedAt) : 'now'}
              </span>
              {session.isOpen && (
                <span className="font-mono text-[10px] text-success">running</span>
              )}
            </div>
            {session.intent && (
              <div className="text-xs text-text mb-1">
                <span className="text-text3">intent · </span>
                {session.intent}
              </div>
            )}
            {session.summary && <div className="text-xs text-text2 mb-2">{session.summary}</div>}
            {breakdown.length > 0 && (
              <ul className="space-y-0.5 mb-2">
                {breakdown.map((b) => (
                  <li key={b.type} className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{ backgroundColor: ACTIVITY_COLORS[b.type as keyof typeof ACTIVITY_COLORS] }}
                      aria-hidden
                    />
                    <span className="font-mono text-[11px] text-text2">{b.type}</span>
                    <span className="font-mono text-[11px] text-text3 ml-auto">
                      {fmtDuration(b.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {session.commits.length > 0 && (
              <ul className="space-y-0.5 border-t border-hair pt-2">
                {session.commits.map((c) => (
                  <Commit key={c.sha} c={c} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
