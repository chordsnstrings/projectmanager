import { useState } from 'react';
import type { TaskDTO } from '@cadence/shared';
import TaskDiscussion from '../components/TaskDiscussion';

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
      <button data-tour="pool" onClick={() => setCreating(true)} className="self-start font-mono text-[11px] text-text3 hover:text-text2">
        + add a task
      </button>
    );
  }

  return (
    <section className="card overflow-hidden" data-tour="pool">
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
          <PoolRow key={t.id} task={t} onClaim={onClaim} />
        ))}
      </ul>
    </section>
  );
}

/** A claimable pool task. Expands to show the brief + discussion so anyone can
 *  read the prior conversation before picking it up. */
function PoolRow({ task, onClaim }: { task: TaskDTO; onClaim: (taskId: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const hasDetails = !!task.description || task.source === 'manual';
  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      await onClaim(task.id);
    } finally {
      setClaiming(false);
    }
  };
  return (
    <li className="border-b border-hair last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          onClick={() => hasDetails && setOpen((v) => !v)}
          className={`min-w-0 flex-1 text-left ${hasDetails ? '' : 'cursor-default'}`}
          aria-expanded={hasDetails ? open : undefined}
        >
          <div className="text-sm text-text truncate tracking-tightish">
            {hasDetails && (
              <span className={`inline-block text-text3 font-mono text-[10px] mr-1.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden>▸</span>
            )}
            {task.title}
          </div>
          <div className="font-mono text-[10px] text-text3">unassigned</div>
        </button>
        <button onClick={claim} disabled={claiming} className="btn btn-sm btn-ghost shrink-0">
          {claiming ? 'picking…' : 'pick up'}
        </button>
      </div>
      {open && hasDetails && (
        <div className="px-4 pb-3.5 -mt-0.5 flex flex-col gap-3 animate-fade-in">
          {task.description ? (
            <div className="flex flex-col gap-1">
              <span className="label">brief</span>
              <p className="text-[13px] text-text2 whitespace-pre-wrap break-words">{task.description}</p>
            </div>
          ) : null}
          <div className="border-t border-hair pt-3">
            <TaskDiscussion taskId={task.id} />
          </div>
        </div>
      )}
    </li>
  );
}
