import { useState } from 'react';
import type { QuestionDTO } from '@cadence/shared';
import { relativeTime } from '../lib/format';

function OpenQuestion({
  question,
  onAnswer,
}: {
  question: QuestionDTO;
  onAnswer: (id: string, answer: string) => void;
}) {
  const [text, setText] = useState('');

  function submit() {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    onAnswer(question.id, trimmed);
    setText('');
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-hair bg-surface/50 p-3.5">
      <div className="flex items-start gap-2">
        {question.blocksNext ? (
          <span className="mt-0.5 tag shrink-0 border-danger/40 bg-danger/10 text-danger">
            blocks next
          </span>
        ) : null}
        <p className="text-sm text-text leading-relaxed break-words">{question.body}</p>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-text3">
          {relativeTime(question.createdAt)}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Type your answer…"
          className="field min-h-[36px] flex-1 px-3 font-mono text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={text.trim().length === 0}
          className="btn btn-md btn-primary disabled:bg-surface2 disabled:text-text3"
        >
          Answer
        </button>
      </div>
    </li>
  );
}

export default function QuestionsForDev({
  questions,
  onAnswer,
}: {
  questions: QuestionDTO[];
  onAnswer: (id: string, answer: string) => void;
}) {
  const open = questions.filter((q) => q.status === 'open');
  if (open.length === 0) return null;

  return (
    <section className="rounded-xl border border-brass/30 bg-brass/[0.06] p-4 sm:p-5 flex flex-col gap-3.5 animate-fade-in">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-brass tracking-tightish">Questions to answer</h2>
        <p className="text-xs text-text2">Answer to unblock completing your next task.</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {open.map((q) => (
          <OpenQuestion key={q.id} question={q} onAnswer={onAnswer} />
        ))}
      </ul>
    </section>
  );
}
