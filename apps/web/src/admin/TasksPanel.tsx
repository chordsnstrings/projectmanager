import { useState } from 'react';
import type { ManagedTask, MemberLite, RepoLite, TaskStatus } from '@cadence/shared';
import { api } from '../lib/api';
import { fmtDuration } from '../lib/format';

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'todo',
  in_progress: 'in progress',
  in_review: 'in review',
  done: 'done',
};

function Avatar({ m, size = 20 }: { m: MemberLite; size?: number }) {
  const s = { width: size, height: size };
  return m.avatarUrl ? (
    <img src={m.avatarUrl} alt={m.githubLogin} title={m.githubLogin} style={s} className="rounded-full shrink-0" />
  ) : (
    <span
      style={s}
      title={m.githubLogin}
      className="rounded-full shrink-0 bg-surface2 grid place-items-center font-mono text-[10px] text-text2"
    >
      {m.githubLogin.slice(0, 1).toUpperCase()}
    </span>
  );
}

function StatusTag({ status }: { status: TaskStatus }) {
  const tone =
    status === 'done' ? 'text-success border-success/30' : status === 'in_review' ? 'text-brass border-brass/30' : 'text-text2 border-hair2';
  return <span className={`tag font-mono ${tone}`}>{STATUS_LABEL[status]}</span>;
}

/** Multi-select collaborator chips. */
function Collaborators({
  roster,
  selected,
  excludeId,
  onToggle,
}: {
  roster: MemberLite[];
  selected: Set<string>;
  excludeId?: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roster
        .filter((m) => m.id !== excludeId)
        .map((m) => {
          const on = selected.has(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onToggle(m.id)}
              className={`chip font-mono text-[11px] ${on ? 'border-brass/50 text-brass bg-brass/10' : 'text-text3'}`}
            >
              {on ? '✓ ' : ''}
              {m.githubLogin}
            </button>
          );
        })}
      {roster.filter((m) => m.id !== excludeId).length === 0 && (
        <span className="font-mono text-[11px] text-text3">no other team members</span>
      )}
    </div>
  );
}

function CreateTask({
  roster,
  onCreated,
  onClose,
}: {
  roster: MemberLite[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [collabs, setCollabs] = useState<Set<string>>(new Set());
  const [estimate, setEstimate] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    await api('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        assigneeUserId: assigneeId || undefined,
        collaboratorIds: [...collabs],
        estimateMinutes: estimate ? Math.max(0, Math.round(Number(estimate))) : null,
      }),
    }).catch(() => {});
    setBusy(false);
    onCreated();
    onClose();
  };

  return (
    <div className="card p-4 flex flex-col gap-3 animate-fade-in">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className="field h-9 px-3 text-sm"
      />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">assignee</span>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="field h-9 px-2.5 text-xs font-mono min-w-[10rem] [color-scheme:dark]">
            <option value="">— unassigned —</option>
            {roster.map((m) => (
              <option key={m.id} value={m.id}>
                {m.githubLogin}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">estimate (min)</span>
          <input
            value={estimate}
            onChange={(e) => setEstimate(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="—"
            inputMode="numeric"
            className="field h-9 px-2.5 text-xs font-mono w-24"
          />
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <span className="label">collaborators</span>
        <Collaborators roster={roster} selected={collabs} excludeId={assigneeId} onToggle={(id) =>
          setCollabs((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          })
        } />
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={onClose} className="btn btn-sm btn-ghost">cancel</button>
        <button type="button" onClick={submit} disabled={!title.trim() || busy} className="btn btn-sm btn-primary">
          {busy ? 'creating…' : 'Create task'}
        </button>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  roster,
  repos,
  onChanged,
}: {
  task: ManagedTask;
  roster: MemberLite[];
  repos: RepoLite[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assigneeId, setAssigneeId] = useState(task.assigneeUserId ?? '');
  const [collabs, setCollabs] = useState<Set<string>>(new Set(task.members.map((m) => m.id)));
  const [estimate, setEstimate] = useState(task.estimateMinutes != null ? String(task.estimateMinutes) : '');
  const [repoId, setRepoId] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [gitErr, setGitErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    await api(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        assigneeUserId: assigneeId || null,
        collaboratorIds: [...collabs],
        estimateMinutes: estimate ? Math.max(0, Math.round(Number(estimate))) : null,
      }),
    }).catch(() => {});
    setBusy(false);
    onChanged();
    setOpen(false);
  };

  const createBranch = async () => {
    if (!repoId || busy) return;
    setBusy(true);
    setGitErr(null);
    try {
      await api(`/tasks/${task.id}/git`, { method: 'POST', body: JSON.stringify({ repoId, branch: branch.trim() || undefined }) });
      onChanged();
    } catch {
      setGitErr('Could not create the branch — check repo access.');
    }
    setBusy(false);
  };

  return (
    <li className="border-b border-hair last:border-b-0">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface/40 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text truncate tracking-tightish">{task.title}</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap font-mono text-[11px] text-text3">
            <StatusTag status={task.status} />
            {task.repoFullName ? (
              <span className="text-text2">{task.repoFullName} · {task.branch}</span>
            ) : (
              <span>no git</span>
            )}
            <span>{fmtDuration(task.actualMinutes)}{task.estimateMinutes ? ` / ${fmtDuration(task.estimateMinutes)}` : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {task.assignee && <Avatar m={task.assignee} />}
          {task.members.slice(0, 3).map((m) => (
            <Avatar key={m.id} m={m} size={18} />
          ))}
          {task.members.length > 3 && <span className="font-mono text-[10px] text-text3">+{task.members.length - 3}</span>}
          <span className="text-text3 text-xs">{open ? '▴' : '▾'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 flex flex-col gap-3 animate-fade-in">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="label">status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="field h-9 px-2.5 text-xs font-mono [color-scheme:dark]">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">assignee</span>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="field h-9 px-2.5 text-xs font-mono min-w-[10rem] [color-scheme:dark]">
                <option value="">— unassigned —</option>
                {roster.map((m) => (
                  <option key={m.id} value={m.id}>{m.githubLogin}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">estimate (min)</span>
              <input value={estimate} onChange={(e) => setEstimate(e.target.value.replace(/[^0-9]/g, ''))} placeholder="—" inputMode="numeric" className="field h-9 px-2.5 text-xs font-mono w-24" />
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <span className="label">collaborators</span>
            <Collaborators roster={roster} selected={collabs} excludeId={assigneeId} onToggle={(id) =>
              setCollabs((prev) => {
                const next = new Set(prev);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              })
            } />
          </div>

          {/* Git linkage */}
          {task.repoFullName ? (
            <div className="font-mono text-[11px] text-text2">
              git: <span className="text-brass">{task.repoFullName}</span> · {task.branch}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="label">create git branch</span>
              <div className="flex flex-wrap items-center gap-2">
                <select value={repoId} onChange={(e) => setRepoId(e.target.value)} className="field h-9 px-2.5 text-xs font-mono min-w-[12rem] [color-scheme:dark]">
                  <option value="">— pick a repo —</option>
                  {repos.map((r) => (
                    <option key={r.id} value={r.id}>{r.fullName}</option>
                  ))}
                </select>
                <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="branch (auto)" className="field h-9 px-2.5 text-xs font-mono w-44" />
                <button type="button" onClick={createBranch} disabled={!repoId || busy} className="btn btn-sm btn-ghost">
                  {busy ? 'creating…' : 'Create branch'}
                </button>
              </div>
              {gitErr && <span className="font-mono text-[11px] text-danger">{gitErr}</span>}
            </div>
          )}

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={async () => {
                if (busy || !confirm('Archive this task? It will be removed from the board.')) return;
                setBusy(true);
                await api(`/tasks/${task.id}`, { method: 'DELETE' }).catch(() => {});
                setBusy(false);
                onChanged();
              }}
              className="btn btn-sm border-danger/40 text-danger hover:bg-danger/10 mr-auto"
            >
              Archive
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-sm btn-ghost">close</button>
            <button type="button" onClick={save} disabled={busy} className="btn btn-sm btn-primary">{busy ? 'saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Admin Tasks tab: create/assign manual tasks, add collaborators, link git. */
export default function TasksPanel({
  tasks,
  roster,
  repos,
  onChanged,
}: {
  tasks: ManagedTask[] | null;
  roster: MemberLite[];
  repos: RepoLite[];
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <section className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text tracking-tightish">Assigned tasks</h2>
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn btn-sm btn-primary">+ New task</button>
        )}
      </div>

      {creating && <CreateTask roster={roster} onCreated={onChanged} onClose={() => setCreating(false)} />}

      {tasks === null ? (
        <div className="card px-4 py-8 text-center font-mono text-xs text-text3">loading…</div>
      ) : tasks.length === 0 ? (
        <div className="card px-4 py-8 text-center font-mono text-xs text-text3">
          No assigned tasks yet. Create one to assign work to the team.
        </div>
      ) : (
        <ul className="card overflow-hidden">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} roster={roster} repos={repos} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}
