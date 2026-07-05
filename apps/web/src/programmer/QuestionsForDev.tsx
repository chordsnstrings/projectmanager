import { useState } from 'react';
import type { QuestionDTO } from '@cadence/shared';
import { relativeTime } from '../lib/format';

function OpenQuestion({
  question,
  onAnswer,
}: {
  question: QuestionDTO;
  onAnswer: (id: string, answer: string) => void | Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    try {
      await onAnswer(question.id, trimmed);
      setText('');
    } finally {
      setBusy(false);
    }
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

      {question.taskTitle ? (
        <div className="font-mono text-[11px] text-text3 truncate -mt-1">
          re: {question.taskOrigin ? `${question.taskOrigin} · ` : ''}
          <span className="text-text2">{question.taskTitle}</span>
          {question.repoFullName ? ` · ${question.repoFullName}` : ''}
        </div>
      ) : null}

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
          disabled={text.trim().length === 0 || busy}
          className="btn btn-md btn-primary disabled:bg-surface2 disabled:text-text3"
        >
          {busy ? 'sending…' : 'Answer'}
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
  onAnswer: (id: string, answer: string) => void | Promise<void>;
}) {
  const open = questions.filter((q) => q.status === 'open');
  if (open.length === 0) return null;
  const blocking = open.some((q) => q.blocksNext);

  return (
    <section
      className={`relative rounded-xl border p-4 sm:p-5 flex flex-col gap-3.5 animate-fade-in shadow-glow-brass ${
        blocking ? 'border-danger/45 bg-danger/[0.07]' : 'border-brass/40 bg-brass/[0.08]'
      }`}
    >
      {/* pulsing attention indicator on the top-left edge */}
      <span
        className={`absolute -top-1.5 -left-1.5 flex h-3.5 w-3.5 ${blocking ? 'text-danger' : 'text-brass'}`}
        aria-hidden
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-current" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className={`text-sm font-semibold tracking-tightish ${blocking ? 'text-danger' : 'text-brass'}`}>
          {open.length === 1 ? 'A question needs your answer' : `${open.length} questions need your answer`}
        </h2>
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
