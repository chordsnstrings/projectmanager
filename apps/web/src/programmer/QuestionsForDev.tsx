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
    <li className="flex flex-col gap-2 rounded border border-hair bg-surface/40 p-3">
      <div className="flex items-start gap-2">
        {question.blocksNext ? (
          <span
            className="mt-1 inline-flex shrink-0 items-center rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-danger"
          >
            blocks next
          </span>
        ) : null}
        <p className="text-sm text-text break-words">{question.body}</p>
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
          className="min-h-[36px] flex-1 rounded border border-hair bg-surface px-2.5 font-mono text-sm text-text placeholder:text-text3 focus:outline-none focus:border-hair2"
        />
        <button
          type="button"
          onClick={submit}
          disabled={text.trim().length === 0}
          className={`min-h-[36px] inline-flex items-center justify-center rounded border px-3 font-mono text-xs transition-colors focus:outline-none ${
            text.trim().length === 0
              ? 'border-hair text-text3 opacity-40 cursor-not-allowed'
              : 'border-brass/40 bg-brass/10 text-brass hover:bg-brass/20'
          }`}
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
    <section className="rounded-lg border border-brass/40 bg-brass/5 p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium text-brass">Questions to answer</h2>
        <p className="text-xs text-text2">Answer to unblock completing your next task.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {open.map((q) => (
          <OpenQuestion key={q.id} question={q} onAnswer={onAnswer} />
        ))}
      </ul>
    </section>
  );
}
