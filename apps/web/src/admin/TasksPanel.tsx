import { useState } from 'react';
import type { ManagedTask, MemberLite, RepoLite, TaskReadiness, TaskStatus } from '@cadence/shared';
import { api, ApiError } from '../lib/api';
import { fmtDuration } from '../lib/format';
import TaskDiscussion from '../components/TaskDiscussion';

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
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    await api('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || null,
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
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe the task / what needs doing (the AI will turn this into steps)…"
        rows={3}
        className="field px-3 py-2 text-sm resize-y"
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
  const [description, setDescription] = useState(task.description ?? '');
  const [plan, setPlan] = useState(task.plan ?? '');
  const [repoId, setRepoId] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [gitErr, setGitErr] = useState<string | null>(null);
  const [gate, setGate] = useState<TaskReadiness | null>(null);

  const save = async () => {
    setBusy(true);
    await api(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        description: description.trim() || null,
        assigneeUserId: assigneeId || null,
        collaboratorIds: [...collabs],
        estimateMinutes: estimate ? Math.max(0, Math.round(Number(estimate))) : null,
      }),
    }).catch(() => {});
    setBusy(false);
    onChanged();
    setOpen(false);
  };

  const generatePlan = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiErr(null);
    // Persist the latest description first so the AI sees it.
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ description: description.trim() || null }) }).catch(() => {});
    try {
      const updated = await api<ManagedTask>(`/tasks/${task.id}/plan`, { method: 'POST', body: '{}' });
      setPlan(updated.plan ?? '');
      onChanged();
    } catch {
      setAiErr('Could not generate steps — is DeepSeek configured? Add a description first.');
    }
    setAiBusy(false);
  };

  const checkReadiness = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiErr(null);
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ description: description.trim() || null }) }).catch(() => {});
    await api(`/tasks/${task.id}/readiness`, { method: 'POST', body: '{}' }).catch(() => setAiErr('Readiness check needs DeepSeek configured.'));
    setAiBusy(false);
    onChanged();
  };

  const savePlan = async (approved?: boolean, override?: boolean) => {
    setAiBusy(true);
    try {
      await api(`/tasks/${task.id}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          plan: plan.trim() || null,
          ...(approved !== undefined ? { approved } : {}),
          ...(override ? { override: true } : {}),
        }),
      });
      setGate(null);
      onChanged();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { error?: string; readiness?: TaskReadiness } | undefined) : undefined;
      if (e instanceof ApiError && e.status === 409 && body?.error === 'not_specified' && body.readiness) {
        setGate(body.readiness);
      }
    }
    setAiBusy(false);
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
          {/* Description → AI step-by-step plan → approval */}
          <div className="flex flex-col gap-1">
            <span className="label">description / brief</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs doing? The AI turns this into clear steps."
              rows={3}
              className="field px-3 py-2 text-sm resize-y"
            />
          </div>

          <div className="rounded-lg border border-hair bg-surface/40 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="label">step-by-step plan {task.planApproved && <span className="text-success">· approved</span>}</span>
              <div className="flex items-center gap-3">
                <button type="button" onClick={checkReadiness} disabled={aiBusy} className="font-mono text-[11px] text-text3 hover:text-text2 disabled:opacity-50">
                  check readiness
                </button>
                <button type="button" onClick={generatePlan} disabled={aiBusy} className="font-mono text-[11px] text-brass hover:text-brass/80 disabled:opacity-50">
                  {aiBusy ? 'thinking…' : plan ? '↻ regenerate' : '✨ generate steps'}
                </button>
              </div>
            </div>
            {aiErr && <span className="font-mono text-[11px] text-danger">{aiErr}</span>}

            {/* AI readiness verdict on the description */}
            {task.readiness && (
              <div className={`rounded-md border px-2.5 py-2 text-[11px] ${task.readiness.ready ? 'border-success/30 bg-success/[0.06]' : 'border-brass/30 bg-brass/[0.06]'}`}>
                <div className="font-mono">
                  {task.readiness.ready ? (
                    <span className="text-success">✓ specified · {task.readiness.score}/100</span>
                  ) : (
                    <span className="text-brass">needs detail · {task.readiness.score}/100</span>
                  )}
                </div>
                {!task.readiness.ready && task.readiness.missing.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-text2">
                    {task.readiness.missing.map((m, i) => (
                      <li key={i}>· {m}</li>
                    ))}
                  </ul>
                )}
                {!task.readiness.ready && task.readiness.questions.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-text3">
                    {task.readiness.questions.map((q, i) => (
                      <li key={i}>? {q}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {plan ? (
              <>
                <textarea
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  rows={Math.min(16, Math.max(5, plan.split('\n').length + 1))}
                  className="field px-3 py-2 text-[13px] font-mono resize-y leading-relaxed"
                />
                {gate && (
                  <div className="rounded-md border border-danger/40 bg-danger/[0.07] px-2.5 py-2 text-[11px] flex flex-col gap-1.5">
                    <span className="text-danger font-mono">This task isn't specified enough to hand off ({gate.score}/100).</span>
                    {gate.missing.length > 0 && (
                      <ul className="text-text2 flex flex-col gap-0.5">{gate.missing.map((m, i) => <li key={i}>· {m}</li>)}</ul>
                    )}
                    <div className="flex items-center gap-2 justify-end mt-1">
                      <button type="button" onClick={() => setGate(null)} className="btn btn-sm btn-ghost">I'll fix it</button>
                      <button type="button" onClick={() => savePlan(true, true)} disabled={aiBusy} className="btn btn-sm border-danger/40 text-danger hover:bg-danger/10">Approve anyway</button>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 justify-end">
                  <button type="button" onClick={() => savePlan()} disabled={aiBusy} className="btn btn-sm btn-ghost">Save plan</button>
                  {task.planApproved ? (
                    <button type="button" onClick={() => savePlan(false)} disabled={aiBusy} className="btn btn-sm btn-ghost text-text3">Unapprove</button>
                  ) : (
                    <button type="button" onClick={() => savePlan(true)} disabled={aiBusy} className="btn btn-sm btn-primary">Approve for assignee</button>
                  )}
                </div>
              </>
            ) : (
              <span className="font-mono text-[11px] text-text3">No plan yet — add a description and generate steps.</span>
            )}
          </div>

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
              <span className="label">connect git</span>
              <div className="flex flex-wrap items-center gap-2">
                <select value={repoId} onChange={(e) => setRepoId(e.target.value)} className="field h-9 px-2.5 text-xs font-mono min-w-[12rem] [color-scheme:dark]">
                  <option value="">— pick a repo —</option>
                  {repos.map((r) => (
                    <option key={r.id} value={r.id}>{r.fullName}</option>
                  ))}
                </select>
                <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="branch (new or existing)" className="field h-9 px-2.5 text-xs font-mono w-48" />
                <button type="button" onClick={createBranch} disabled={!repoId || busy} className="btn btn-sm btn-ghost">
                  {busy ? 'connecting…' : 'Connect'}
                </button>
              </div>
              <span className="font-mono text-[10px] text-text3">
                Leave the branch blank to auto-name a new one, or type an existing branch to link it.
              </span>
              {gitErr && <span className="font-mono text-[11px] text-danger">{gitErr}</span>}
            </div>
          )}

          <div className="border-t border-hair pt-3">
            <TaskDiscussion taskId={task.id} />
          </div>

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
  hasMore = false,
  onLoadMore,
}: {
  tasks: ManagedTask[] | null;
  roster: MemberLite[];
  repos: RepoLite[];
  onChanged: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
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
          {hasMore && (
            <li>
              <button
                type="button"
                onClick={() => onLoadMore?.()}
                className="w-full py-3 font-mono text-[11px] text-text3 hover:text-text2 hover:bg-surface/40 transition-colors border-t border-hair"
              >
                show more tasks ↓
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
