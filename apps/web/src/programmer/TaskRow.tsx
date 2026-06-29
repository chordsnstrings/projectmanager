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
import TaskDiscussion from '../components/TaskDiscussion';
import TaskGitConnect from '../components/TaskGitConnect';

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
  onStart?: (taskId: string, intent?: string) => void;
  onStop?: (sessionId: string) => void;
  onOverrideActivity?: (sessionId: string, activity: ActivityType) => void;
  /** the current user's team activity keys (for the one-tap cycle) */
  activityKeys?: string[];
  onSaveSummary?: (
    sessionId: string,
    payload: { summary: string; blocked: boolean; closesIssues: number[] },
  ) => void;
  /** rename the task in-app only (Cadence-local; not pushed to GitHub) */
  onRename?: (taskId: string, title: string) => void;
  /** refresh the board (e.g. after connecting git) */
  onRefresh?: () => void;
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

const STATUS_DOT: Record<TaskStatus, string> = {
  todo: '#6a7080',
  in_progress: '#2bd4a0',
  in_review: '#5aa6f0',
  done: '#5cc28d',
};

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] font-medium ${STATUS_TONE[status]}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[status] }} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

const DEFAULT_ACTIVITIES: ActivityType[] = ['coding', 'debugging', 'research', 'agent', 'review'];

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
  onRefresh = noop,
  activityKeys,
}: TaskRowProps) {
  const running = state === 'running';
  const wrapping = state === 'wrapping';
  const activity: ActivityType | null = session?.inferredActivity ?? null;
  const cycle = activityKeys && activityKeys.length > 0 ? activityKeys : DEFAULT_ACTIVITIES;
  const [showDetails, setShowDetails] = useState(false);
  const [starting, setStarting] = useState(false);
  const [intentText, setIntentText] = useState('');
  // Manual tasks (and anything with a brief/plan) carry a details panel:
  // description, the approved step-by-step, and a comment thread.
  const hasDetails = !!(task.description || task.plan) || task.source === 'manual';
  const beginStart = () => {
    const t = intentText.trim();
    if (!t) return;
    onStart(task.id, t);
    setStarting(false);
    setIntentText('');
  };

  // The signature 3px left edge — only on a running row, colored by activity.
  const edgeStyle =
    running && session
      ? { boxShadow: `inset 3px 0 0 0 ${activityColor(activity)}` }
      : undefined;

  return (
    <div
      className={`group relative border-b border-white/[0.05] last:border-b-0 transition-colors duration-200 ${
        running ? 'bg-white/[0.035]' : 'hover:bg-white/[0.025]'
      }`}
    >
      {/* signature activity edge — a soft glowing bar on running rows */}
      {running && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full"
          style={{ background: activityColor(activity), boxShadow: `0 0 14px ${activityColor(activity)}55` }}
          aria-hidden
        />
      )}
      <div className="flex items-center gap-4 px-4 sm:px-5 py-4">
        {/* Left: title + meta */}
        <div className="min-w-0 flex-1">
          <TitleEditor task={task} onRename={onRename} />
          <div className="mt-1.5 flex items-center gap-2.5 flex-wrap text-[11px] text-text3">
            <Origin task={task} />
            {task.repoFullName ? (
              <>
                <span className="opacity-30">·</span>
                <span className="font-mono">{task.repoFullName}</span>
              </>
            ) : task.source === 'manual' ? (
              <>
                <span className="opacity-30">·</span>
                <span className="font-mono text-text3">no git</span>
              </>
            ) : null}
            <StatusBadge status={task.status} />
            {task.estimateMinutes != null && (
              <span className="font-mono">est {fmtDuration(task.estimateMinutes)}</span>
            )}
            {task.reopenCount > 0 && <span className="font-mono text-danger/80">↻ {task.reopenCount}</span>}
          </div>
        </div>

        {/* Right: controls per state */}
        <div className="flex items-center gap-3 shrink-0">
          {hasDetails && (
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className={`font-mono text-[11px] transition-colors ${showDetails ? 'text-brass' : 'text-text3 hover:text-text2'}`}
              title="task brief, steps & discussion"
            >
              {task.planApproved ? 'steps' : 'details'} {showDetails ? '▴' : '▾'}
            </button>
          )}
          {running && session && (
            <>
              <button
                type="button"
                onClick={() => onOverrideActivity(session.id, nextActivity(activity, cycle))}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full transition-transform active:scale-90 hover:bg-white/[0.05]"
                title={`activity: ${activity ?? 'idle'} (tap to change)`}
                aria-label="change activity"
              >
                <ActivityDot activity={activity} size={11} />
              </button>
              <span className="font-mono text-[15px] tabular-nums text-brass font-medium" aria-label="elapsed">
                <LiveTimer startedAt={session.startedAt} />
              </span>
              <button
                type="button"
                onClick={() => onStop(session.id)}
                className="w-10 h-10 grid place-items-center rounded-full border border-danger/40 text-danger transition-all duration-150 ease-smooth hover:bg-danger/15 hover:border-danger/60 active:scale-90"
                title="stop session"
                aria-label="stop session"
              >
                <StopIcon />
              </button>
            </>
          )}
          {state === 'idle' && (
            <button
              type="button"
              onClick={() => setStarting((v) => !v)}
              className="w-10 h-10 grid place-items-center rounded-full border border-white/[0.1] text-text2 pl-0.5 transition-all duration-150 ease-smooth hover:bg-brass hover:text-[#1a140a] hover:border-brass hover:shadow-glow-brass active:scale-90"
              title="start session"
              aria-label="start session"
            >
              <PlayIcon />
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

      {/* Start prompt — capture what they're about to work on (intent) */}
      {starting && state === 'idle' && (
        <div className="px-4 sm:px-5 pb-4 -mt-1 flex flex-col gap-1.5 animate-fade-in">
          <span className="label">what are you working on?</span>
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={intentText}
              maxLength={300}
              onChange={(e) => setIntentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') beginStart();
                if (e.key === 'Escape') setStarting(false);
              }}
              placeholder="e.g. wiring the OAuth callback + a couple of tests"
              className="field h-9 px-3 text-sm flex-1"
            />
            <button type="button" onClick={() => setStarting(false)} className="btn btn-sm btn-ghost">cancel</button>
            <button type="button" onClick={beginStart} disabled={!intentText.trim()} className="btn btn-sm btn-primary">Start</button>
          </div>
          <span className="font-mono text-[10px] text-text3 self-end">{intentText.length}/300</span>
        </div>
      )}

      {showDetails && hasDetails && (
        <div className="px-4 sm:px-5 pb-4 -mt-1 flex flex-col gap-3 animate-fade-in">
          {task.description ? (
            <div className="flex flex-col gap-1">
              <span className="label">brief</span>
              <p className="text-[13px] text-text2 whitespace-pre-wrap break-words">{task.description}</p>
            </div>
          ) : null}
          {task.planApproved && task.plan ? (
            <div className="flex flex-col gap-1 rounded-lg border border-hair bg-surface/40 p-3">
              <span className="label">your steps</span>
              <div className="text-[13px] text-text2 whitespace-pre-wrap break-words leading-relaxed font-mono">{task.plan}</div>
            </div>
          ) : task.plan && !task.planApproved ? (
            <div className="font-mono text-[11px] text-text3">Steps are being prepared — pending approval.</div>
          ) : null}
          {task.source === 'manual' && <TaskGitConnect task={task} onConnected={onRefresh} />}
          <div className="border-t border-hair pt-3">
            <TaskDiscussion taskId={task.id} />
          </div>
        </div>
      )}

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
    <span className="group/title inline-flex items-center gap-1 min-w-0 max-w-full">
      <span className="text-[15px] text-text font-medium truncate tracking-tightish">{task.title}</span>
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

function nextActivity(current: ActivityType | null, cycle: ActivityType[]): ActivityType {
  const idx = current ? cycle.indexOf(current) : -1;
  return cycle[(idx + 1) % cycle.length] ?? cycle[0] ?? 'coding';
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
