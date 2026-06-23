import { useEffect, useState } from 'react';
import type { CompletionItem, Paginated } from '@cadence/shared';
import { api } from '../lib/api';
import { fmtDuration, relativeTime } from '../lib/format';

/** Browseable list of completed tasks. `userId` set by admin; omit for self. */
export default function CompletionLog({ userId }: { userId?: string }) {
  const [items, setItems] = useState<CompletionItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const qs = (c?: string) => {
    const p = new URLSearchParams();
    if (userId) p.set('userId', userId);
    if (c) p.set('cursor', c);
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api<Paginated<CompletionItem>>(`/completions${qs()}`)
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setCursor(r.nextCursor);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const more = async () => {
    if (!cursor) return;
    const r = await api<Paginated<CompletionItem>>(`/completions${qs(cursor)}`).catch(() => null);
    if (!r) return;
    setItems((prev) => [...prev, ...r.items]);
    setCursor(r.nextCursor);
  };

  if (loading) return <div className="card px-4 py-8 text-center font-mono text-xs text-text3">loading…</div>;
  if (items.length === 0)
    return <div className="card px-4 py-8 text-center font-mono text-xs text-text3">No completed tasks yet.</div>;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-hair label">completion log · {items.length}{cursor ? '+' : ''}</div>
      <ul>
        {items.map((c) => (
          <li key={c.taskId} className="flex items-center gap-3 px-4 py-3 border-b border-hair last:border-b-0">
            <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text truncate tracking-tightish">{c.title}</div>
              <div className="font-mono text-[11px] text-text3 truncate mt-0.5">
                {c.repoFullName} · {c.origin}
                {c.milestoneTitle ? ` · ${c.milestoneTitle}` : ''}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-[11px] text-text2">{fmtDuration(c.actualMinutes)}{c.estimateMinutes ? ` / ${fmtDuration(c.estimateMinutes)}` : ''}</div>
              <div className="font-mono text-[10px] text-text3">{c.closedAt ? relativeTime(c.closedAt) : '—'}</div>
            </div>
          </li>
        ))}
      </ul>
      {cursor && (
        <button onClick={more} className="w-full py-2.5 text-center font-mono text-xs text-text3 hover:text-text2 border-t border-hair">
          load more
        </button>
      )}
    </div>
  );
}
