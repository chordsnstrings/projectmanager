import type { QuestionDTO } from '@cadence/shared';
import { fmtClock, relativeTime } from '../lib/format';

function StatusBadge({ status }: { status: QuestionDTO['status'] }) {
  const open = status === 'open';
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
        open ? 'text-brass border-brass/40 bg-brass/10' : 'text-success border-success/40 bg-success/10'
      }`}
    >
      {open ? 'open' : 'answered'}
    </span>
  );
}

function BlocksChip() {
  return (
    <span className="shrink-0 inline-flex items-center rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-danger">
      blocks next
    </span>
  );
}

function QuestionRow({ q }: { q: QuestionDTO }) {
  return (
    <li className="border-b border-hair last:border-b-0 px-4 py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={q.status} />
        {q.blocksNext ? <BlocksChip /> : null}
        <span className="font-mono text-[11px] text-text3 ml-auto" title={fmtClock(q.createdAt)}>
          {relativeTime(q.createdAt)}
        </span>
      </div>

      <p className="text-sm text-text break-words">{q.body}</p>

      {q.status === 'answered' && q.answer != null ? (
        <div className="ml-3 border-l-2 border-success/40 pl-3 flex flex-col gap-1">
          <p className="text-sm text-text2 break-words">{q.answer}</p>
          {q.answeredAt != null ? (
            <span className="font-mono text-[11px] text-text3" title={fmtClock(q.answeredAt)}>
              answered {relativeTime(q.answeredAt)}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function QuestionsPanel({ questions }: { questions: QuestionDTO[] }) {
  const sorted = [...questions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <section className="rounded-lg border border-hair bg-panel overflow-hidden">
      <header className="px-4 py-3 border-b border-hair flex items-center justify-between">
        <h2 className="text-sm font-medium text-text">Questions</h2>
        <span className="font-mono text-xs text-text3">{sorted.length}</span>
      </header>

      {sorted.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-text3">No questions raised.</div>
      ) : (
        <ul>
          {sorted.map((q) => (
            <QuestionRow key={q.id} q={q} />
          ))}
        </ul>
      )}
    </section>
  );
}
