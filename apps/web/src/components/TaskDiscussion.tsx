import { useEffect, useState } from 'react';
import type { TaskCommentDTO } from '@cadence/shared';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';

/** Comment thread on a task (giver ↔ receiver). Self-contained: fetches + posts. */
export default function TaskDiscussion({ taskId }: { taskId: string }) {
  const [comments, setComments] = useState<TaskCommentDTO[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<TaskCommentDTO[]>(`/tasks/${taskId}/comments`)
      .then((r) => !cancelled && setComments(r))
      .catch(() => !cancelled && setComments([]));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const created = await api<TaskCommentDTO>(`/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }).catch(() => null);
    setBusy(false);
    if (created) {
      setComments((prev) => [...(prev ?? []), created]);
      setText('');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="label">discussion</div>
      {comments === null ? (
        <div className="font-mono text-[11px] text-text3">loading…</div>
      ) : comments.length === 0 ? (
        <div className="font-mono text-[11px] text-text3">No comments yet.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2">
              {c.authorAvatarUrl ? (
                <img src={c.authorAvatarUrl} alt="" className="w-5 h-5 rounded-full shrink-0 mt-0.5" />
              ) : (
                <span className="w-5 h-5 rounded-full shrink-0 mt-0.5 bg-surface2 grid place-items-center font-mono text-[9px] text-text2">
                  {c.authorLogin.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] text-text3">
                  {c.authorLogin} · {relativeTime(c.createdAt)}
                </div>
                <div className="text-[13px] text-text2 whitespace-pre-wrap break-words">{c.body}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Add a comment…"
          className="field h-9 px-3 text-sm flex-1"
        />
        <button onClick={send} disabled={!text.trim() || busy} className="btn btn-sm btn-ghost">
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
