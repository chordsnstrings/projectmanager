import type { TimelineSession } from '@cadence/shared';
import { ACTIVITY_COLORS } from '../lib/activity';
import { fmtClock, fmtDuration } from '../lib/format';

function activityBreakdown(session: TimelineSession): { type: string; minutes: number }[] {
  const totals = new Map<string, number>();
  for (const seg of session.segments) {
    const a = new Date(seg.startedAt).getTime();
    const b = new Date(seg.endedAt).getTime();
    totals.set(seg.type, (totals.get(seg.type) ?? 0) + Math.max(0, (b - a) / 60_000));
  }
  return [...totals.entries()].map(([type, minutes]) => ({ type, minutes }));
}

/** Detail for a selected session, rendered in normal flow below the timeline. */
export default function SessionDetail({
  session,
  laneTitle,
  onClose,
}: {
  session: TimelineSession;
  laneTitle: string;
  onClose: () => void;
}) {
  const breakdown = activityBreakdown(session);
  return (
    <div className="border-t border-hair2 bg-surface/60 px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="text-sm text-text truncate">{laneTitle}</span>
          <span className="ml-2 font-mono text-xs text-text2">
            {fmtClock(session.startedAt)}–{session.endedAt ? fmtClock(session.endedAt) : 'now'}
          </span>
          {session.isOpen && <span className="ml-2 font-mono text-[10px] text-success">running</span>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded border border-hair text-text3 hover:text-text hover:border-hair2"
          aria-label="close detail"
        >
          ✕
        </button>
      </div>

      {session.intent && (
        <div className="text-xs text-text mb-1">
          <span className="text-text3">intent · </span>
          {session.intent}
        </div>
      )}
      {session.summary && <div className="text-xs text-text2 mb-2">{session.summary}</div>}

      <div className="grid sm:grid-cols-2 gap-3">
        {breakdown.length > 0 && (
          <ul className="space-y-0.5">
            {breakdown.map((b) => (
              <li key={b.type} className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ backgroundColor: ACTIVITY_COLORS[b.type as keyof typeof ACTIVITY_COLORS] }}
                  aria-hidden
                />
                <span className="font-mono text-[11px] text-text2">{b.type}</span>
                <span className="font-mono text-[11px] text-text3 ml-auto">{fmtDuration(b.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
        {session.commits.length > 0 && (
          <ul className="space-y-0.5 sm:border-l sm:border-hair sm:pl-3">
            {session.commits.map((c) => (
              <li key={c.sha} className="font-mono text-[11px] text-text2 flex gap-2">
                <span className="text-text3">{fmtClock(c.occurredAt)}</span>
                <span>{c.sha.slice(0, 7)}</span>
                <span className="truncate">{c.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {breakdown.length === 0 && session.commits.length === 0 && (
        <div className="font-mono text-[11px] text-text3">no segments or commits recorded</div>
      )}
    </div>
  );
}
