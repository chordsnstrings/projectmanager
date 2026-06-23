import { useEffect, useState } from 'react';
import type {
  ActivityType,
  CommitDTO,
  DraftSummary,
  SessionDTO,
  TaskDTO,
  TaskStatus,
} from '@cadence/shared';
import { fmtDuration, liveElapsed } from '../lib/format';
import { ActivityDot, activityColor } from './activityDot';

export type TaskRowState = 'idle' | 'running' | 'wrapping';

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'assigned',
  in_progress: 'in progress',
  in_review: 'in review',
  done: 'done',
};

const STATUS_TONE: Record<TaskStatus, string> = {
  todo: 'text-text3 border-hair bg-surface/40',
  in_progress: 'text-activity-coding border-activity-coding/30 bg-activity-coding/5',
  in_review: 'text-activity-research border-activity-research/30 bg-activity-research/5',
  done: 'text-success border-success/30 bg-success/5',
};

export interface TaskRowProps {
  task: TaskDTO;
  state: TaskRowState;
  /** required when state === 'running' or 'wrapping' */
  session?: SessionDTO;
  /** required when state === 'wrapping' */
  draft?: DraftSummary;
  commits?: CommitDTO[];
  onStart?: (taskId: string) => void;
  onStop?: (sessionId: string) => void;
  onOverrideActivity?: (sessionId: string, activity: ActivityType) => void;
  onSaveSummary?: (
    sessionId: string,
    payload: { summary: string; blocked: boolean; closesIssues: number[] },
  ) => void;
  /** rename the task in-app only (Cadence-local; not pushed to GitHub) */
  onRename?: (taskId: string, title: string) => void;
}

const noop = () => {};

/** Live mm:ss / h:mm:ss ticker driven client-side. */
function LiveTimer({ startedAt }: { startedAt: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="font-mono tabular-nums">{liveElapsed(startedAt)}</span>;
}

/** origin glyph: issue "#142" (with dot), "PR #88", or a branch name. */
function Origin({ task }: { task: TaskDTO }) {
  if (task.source === 'issue') {
    return (
      <span className="font-mono text-text2 inline-flex items-center gap-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-text3"
          aria-hidden
        />
        {task.origin}
      </span>
    );
  }
  if (task.source === 'pr') {
    return <span className="font-mono text-text2">{task.origin}</span>;
  }
  return <span className="font-mono text-activity-coding/80">{task.origin}</span>;
}

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`tag ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const ACTIVITIES: ActivityType[] = ['coding', 'debugging', 'research', 'agent', 'review'];

export default function TaskRow({
  task,
  state,
  session,
  draft,
  commits,
  onStart = noop,
  onStop = noop,
  onOverrideActivity = noop,
  onSaveSummary = noop,
  onRename = noop,
}: TaskRowProps) {
  const running = state === 'running';
  const wrapping = state === 'wrapping';
  const activity: ActivityType | null = session?.inferredActivity ?? null;

  // The signature 3px left edge — only on a running row, colored by activity.
  const edgeStyle =
    running && session
      ? { boxShadow: `inset 3px 0 0 0 ${activityColor(activity)}` }
      : undefined;

  return (
    <div
      className={`border-b border-hair last:border-b-0 transition-colors ${
        running ? 'bg-surface/50' : 'hover:bg-surface/25'
      }`}
      style={edgeStyle}
    >
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
        {/* Left: origin + title + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Origin task={task} />
            <TitleEditor task={task} onRename={onRename} />
          </div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px]">
            <span className="font-mono text-text3 px-1.5 py-0.5 rounded-md border border-hair bg-surface/40">
              {task.repoFullName}
            </span>
            <StatusBadge status={task.status} />
            {task.estimateMinutes != null && (
              <span className="font-mono text-text3">
                est {fmtDuration(task.estimateMinutes)}
              </span>
            )}
            {task.reopenCount > 0 && (
              <span className="font-mono text-danger/80">↻ {task.reopenCount}</span>
            )}
          </div>
        </div>

        {/* Right: controls per state */}
        <div className="flex items-center gap-3 shrink-0">
          {running && session && (
            <>
              <button
                type="button"
                onClick={() => onOverrideActivity(session.id, nextActivity(activity))}
                className="inline-flex items-center justify-center w-9 h-9 -mx-1 text-text2 hover:text-text"
                title={`activity: ${activity ?? 'idle'} (tap to override)`}
                aria-label="override activity"
              >
                <ActivityDot activity={activity} size={10} />
              </button>
              <span className="text-sm text-text tabular-nums font-mono" aria-label="elapsed">
                <LiveTimer startedAt={session.startedAt} />
              </span>
              <button
                type="button"
                onClick={() => onStop(session.id)}
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-danger/40 text-danger hover:bg-danger/15 hover:border-danger/60 transition-colors"
                title="stop session"
                aria-label="stop session"
              >
                <span className="text-xs leading-none">■</span>
              </button>
            </>
          )}
          {state === 'idle' && (
            <button
              type="button"
              onClick={() => onStart(task.id)}
              className="btn btn-md btn-ghost hover:border-brass/40 hover:text-brass"
              title="start session"
            >
              <span className="text-[10px] leading-none">▶</span>
              <span>start</span>
            </button>
          )}
          {wrapping && (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-brass">
              <span className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" aria-hidden />
              wrapping…
            </span>
          )}
        </div>
      </div>

      {wrapping && session && draft && (
        <WrapPanel
          session={session}
          draft={draft}
          commits={commits ?? []}
          onSaveSummary={onSaveSummary}
        />
      )}
    </div>
  );
}

/** Title with an inline rename (Cadence-local override). */
function TitleEditor({
  task,
  onRename,
}: {
  task: TaskDTO;
  onRename: NonNullable<TaskRowProps['onRename']>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(task.title);

  if (editing) {
    const commit = () => {
      setEditing(false);
      if (name.trim() && name.trim() !== task.title) onRename(task.id, name.trim());
    };
    return (
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setName(task.title);
            setEditing(false);
          }
        }}
        className="field text-sm px-2 py-0.5 min-w-0 flex-1"
        aria-label="rename task"
      />
    );
  }
  return (
    <span className="group inline-flex items-center gap-1 min-w-0">
      <span className="text-sm text-text font-medium truncate tracking-tightish">{task.title}</span>
      <button
        type="button"
        onClick={() => {
          setName(task.title);
          setEditing(true);
        }}
        className="shrink-0 text-text3 hover:text-text2 w-7 h-7 -my-1 inline-flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        title="rename (in Cadence only)"
        aria-label="rename task"
      >
        <span className="text-[11px] leading-none">✎</span>
      </button>
    </span>
  );
}

function nextActivity(current: ActivityType | null): ActivityType {
  const idx = current ? ACTIVITIES.indexOf(current) : -1;
  return ACTIVITIES[(idx + 1) % ACTIVITIES.length] ?? 'coding';
}

function WrapPanel({
  session,
  draft,
  commits,
  onSaveSummary,
}: {
  session: SessionDTO;
  draft: DraftSummary;
  commits: CommitDTO[];
  onSaveSummary: NonNullable<TaskRowProps['onSaveSummary']>;
}) {
  const [summary, setSummary] = useState(draft.summary);
  const [blocked, setBlocked] = useState(session.blocked);
  const [closes, setCloses] = useState<number[]>(draft.closesIssues);

  const toggleClose = (n: number) =>
    setCloses((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));

  return (
    <div className="px-4 sm:px-5 pb-4 pt-3 border-t border-hair bg-surface/30 animate-fade-in">
      {/* detected line */}
      <div className="font-mono text-xs text-text2 mb-3">{draft.detected}</div>

      {/* activity split bar */}
      {draft.activitySplit.length > 0 && (
        <div className="flex h-1.5 w-full overflow-hidden rounded-full mb-3.5">
          {draft.activitySplit.map((s) => (
            <span
              key={s.type}
              className="h-full"
              style={{
                width: `${Math.round(s.fraction * 100)}%`,
                backgroundColor: activityColor(s.type),
              }}
              title={`${s.type} ${Math.round(s.fraction * 100)}%`}
            />
          ))}
        </div>
      )}

      {/* editable one-line draft summary */}
      <input
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="one-line summary…"
        className="field w-full px-3 py-2 text-sm"
      />

      {/* chips */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setBlocked((b) => !b)}
          className={`tag transition-colors ${
            blocked
              ? 'text-danger border-danger/50 bg-danger/10'
              : 'text-text3 border-hair hover:border-hair2 hover:text-text2'
          }`}
        >
          blocked
        </button>
        {draft.closesIssues.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => toggleClose(n)}
            className={`tag transition-colors ${
              closes.includes(n)
                ? 'text-success border-success/50 bg-success/10'
                : 'text-text3 border-hair hover:border-hair2 hover:text-text2'
            }`}
          >
            closes #{n}
          </button>
        ))}

        <button
          type="button"
          onClick={() => onSaveSummary(session.id, { summary, blocked, closesIssues: closes })}
          className="ml-auto btn btn-sm btn-primary"
        >
          Save
        </button>
      </div>

      {/* commit list */}
      {commits.length > 0 && (
        <ul className="mt-3.5 space-y-1.5 border-t border-hair pt-3">
          {commits.map((c) => (
            <li key={c.sha} className="font-mono text-[11px] text-text3 flex gap-2">
              <span className="text-text2">{c.sha.slice(0, 7)}</span>
              <span className="truncate text-text2">{c.message}</span>
              {c.additions != null && c.deletions != null && (
                <span className="shrink-0">
                  <span className="text-success">+{c.additions}</span>{' '}
                  <span className="text-danger">−{c.deletions}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
