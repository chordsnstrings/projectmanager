import { useState } from 'react';
import type { TaskDTO } from '@cadence/shared';

/** Team task pool: claim an open task or add your own (self-serve). */
export default function TaskPool({
  pool,
  onClaim,
  onCreateTask,
}: {
  pool: TaskDTO[];
  onClaim: (taskId: string) => void;
  onCreateTask: (title: string, estimateMinutes: number | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [estimate, setEstimate] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    await onCreateTask(title.trim(), estimate ? Math.max(0, Math.round(Number(estimate))) : null);
    setBusy(false);
    setTitle('');
    setEstimate('');
    setCreating(false);
  };

  // Hide entirely when there's nothing to pick up and you're not adding one.
  if (pool.length === 0 && !creating) {
    return (
      <button onClick={() => setCreating(true)} className="self-start font-mono text-[11px] text-text3 hover:text-text2">
        + add a task
      </button>
    );
  }

  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-hair flex items-center justify-between">
        <span className="label">open tasks · pick up{pool.length ? ` · ${pool.length}` : ''}</span>
        {!creating && (
          <button onClick={() => setCreating(true)} className="font-mono text-[11px] text-brass hover:text-brass/80">
            + new task
          </button>
        )}
      </div>

      {creating && (
        <div className="px-4 py-3 border-b border-hair flex flex-wrap items-center gap-2 bg-surface/40">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="What needs doing?"
            className="field h-9 px-3 text-sm flex-1 min-w-[12rem]"
          />
          <input
            value={estimate}
            onChange={(e) => setEstimate(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="est min"
            inputMode="numeric"
            className="field h-9 px-2.5 text-xs font-mono w-20"
          />
          <button onClick={() => setCreating(false)} className="btn btn-sm btn-ghost">cancel</button>
          <button onClick={submit} disabled={!title.trim() || busy} className="btn btn-sm btn-primary">
            {busy ? 'adding…' : 'Add'}
          </button>
        </div>
      )}

      <ul>
        {pool.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-hair last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text truncate tracking-tightish">{t.title}</div>
              <div className="font-mono text-[10px] text-text3">unassigned</div>
            </div>
            <button onClick={() => onClaim(t.id)} className="btn btn-sm btn-ghost shrink-0">
              pick up
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
