import { useState } from 'react';
import type { QuestionDTO, TimelineSession } from '@cadence/shared';
import { ACTIVITY_COLORS } from '../lib/activity';
import { fmtClock, fmtDuration, relativeTime } from '../lib/format';

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
  onAsk,
  canAsk = false,
  questions = [],
}: {
  session: TimelineSession;
  laneTitle: string;
  onClose: () => void;
  /** raise a question pinned to this session/task (gates the dev's next completion) */
  onAsk?: (body: string) => void;
  canAsk?: boolean;
  /** questions already raised on this session (thread) */
  questions?: QuestionDTO[];
}) {
  const breakdown = activityBreakdown(session);
  const [asking, setAsking] = useState(false);
  const [body, setBody] = useState('');
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
        <div className="flex items-center gap-2 shrink-0">
          {onAsk && (
            <button
              type="button"
              onClick={() => setAsking((a) => !a)}
              disabled={!canAsk}
              title={canAsk ? 'raise a question on this session' : 'off-task sessions have no task to ask about'}
              className="font-mono text-xs px-2.5 h-8 rounded border border-brass/50 text-brass hover:bg-brass/10 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              ask…
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center rounded border border-hair text-text3 hover:text-text hover:border-hair2"
            aria-label="close detail"
          >
            ✕
          </button>
        </div>
      </div>

      {asking && onAsk && (
        <div className="mb-3 flex items-center gap-2">
          <input
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && body.trim()) {
                onAsk(body.trim());
                setBody('');
                setAsking(false);
              }
              if (e.key === 'Escape') setAsking(false);
            }}
            placeholder="ask why… (gates their next task completion)"
            className="flex-1 min-w-0 text-sm bg-surface border border-hair2 rounded px-2.5 h-9 text-text placeholder:text-text3 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (body.trim()) {
                onAsk(body.trim());
                setBody('');
                setAsking(false);
              }
            }}
            className="font-mono text-xs px-3 h-9 rounded bg-brass text-bg font-medium hover:opacity-90"
          >
            send
          </button>
        </div>
      )}

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

      {questions.length > 0 && (
        <div className="mt-3 border-t border-hair pt-2 space-y-2">
          {questions.map((q) => (
            <div key={q.id} className="rounded border border-brass/30 bg-brass/5 p-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-brass uppercase tracking-wide">question</span>
                <span className={`font-mono text-[10px] ${q.status === 'answered' ? 'text-success' : 'text-text3'}`}>
                  {q.status}
                </span>
                <span className="font-mono text-[10px] text-text3 ml-auto">{relativeTime(q.createdAt)}</span>
              </div>
              <div className="text-xs text-text mt-1">{q.body}</div>
              {q.answer && (
                <div className="text-xs text-text2 mt-1 pl-2 border-l border-hair2">↳ {q.answer}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
