import { useEffect, useState } from 'react';
import type { Paginated, TaskDTO } from '@cadence/shared';
import { api } from '../lib/api';

// Status labels (the runtime enum value can't be imported from the CommonJS shared build).
const STATUS_LABEL: Record<string, string> = {
  todo: 'todo',
  in_progress: 'in progress',
  in_review: 'in review',
  blocked: 'blocked',
  done: 'done',
};

/**
 * Lets an admin raise a question about ANY of a person's tasks — including
 * closed/done ones (questions about past work) — without needing a session bar
 * on the viewed day. Posts with a null sessionId.
 */
export default function AskAboutTask({
  targetUserId,
  onSent,
}: {
  targetUserId: string;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [taskId, setTaskId] = useState('');
  const [body, setBody] = useState('');
  const [blocksNext, setBlocksNext] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api<Paginated<TaskDTO>>(`/tasks?userId=${encodeURIComponent(targetUserId)}`)
      .then((res) => {
        if (cancelled) return;
        setTasks(res.items);
        setTaskId((prev) => prev || res.items[0]?.id || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, targetUserId]);

  const submit = async () => {
    if (!taskId || !body.trim()) return;
    setBusy(true);
    try {
      await api('/questions', {
        method: 'POST',
        body: JSON.stringify({ targetUserId, taskId, body: body.trim(), blocksNext }),
      });
      setBody('');
      setSent(true);
      onSent?.();
      setTimeout(() => setSent(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  // Open tasks first, then closed — closed are explicitly available for past-work questions.
  const sorted = [...tasks].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-sm btn-ghost">
        + Ask about a task
      </button>
    );
  }

  return (
    <div className="card p-4 flex flex-col gap-3 animate-fade-in w-full sm:w-[28rem]">
      <div className="flex items-center justify-between">
        <span className="label">ask about a task</span>
        <button type="button" onClick={() => setOpen(false)} className="text-text3 hover:text-text2 text-sm">
          ✕
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="label">task (open &amp; closed)</span>
        <select
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          className="field font-mono text-xs px-2.5 h-9 [color-scheme:dark]"
        >
          {sorted.length === 0 && <option value="">no tasks found</option>}
          {sorted.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} · {STATUS_LABEL[t.status] ?? t.status}
            </option>
          ))}
        </select>
      </label>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Your question about this work…"
        className="field px-3 py-2 text-sm resize-none"
      />

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setBlocksNext((b) => !b)}
          role="switch"
          aria-checked={blocksNext}
          className="inline-flex items-center gap-2 font-mono text-[11px] text-text3 hover:text-text2 transition-colors"
        >
          <span
            className={`relative inline-block w-7 h-4 rounded-full border transition-colors ${
              blocksNext ? 'bg-danger/25 border-danger/60' : 'border-hair2'
            }`}
          >
            <span
              className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                blocksNext ? 'left-3.5 bg-danger' : 'left-0.5 bg-text3'
              }`}
            />
          </span>
          blocks next completion
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !taskId || !body.trim()}
          className="btn btn-md btn-primary disabled:bg-surface2 disabled:text-text3"
        >
          {sent ? 'sent ✓' : busy ? 'sending…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
