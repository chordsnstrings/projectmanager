import type {
  ActivityType,
  CommitDTO,
  DraftSummary,
  NudgeDTO,
  SessionDTO,
  TaskDTO,
} from '@cadence/shared';
import TaskRow, { type TaskRowState } from './TaskRow';

/** Per-task UI state bundle resolved by the parent (no fetching here). */
export interface TaskSessionState {
  state: TaskRowState;
  session?: SessionDTO;
  draft?: DraftSummary;
  commits?: CommitDTO[];
}

export interface ProgrammerScreenProps {
  login: string;
  syncedAgo: string;
  date: string;
  nudge?: NudgeDTO | null;
  tasks: TaskDTO[];
  /** keyed by task id */
  sessionsByTask: Record<string, TaskSessionState>;
  onStart?: (taskId: string) => void;
  onStop?: (sessionId: string) => void;
  onOverrideActivity?: (sessionId: string, activity: ActivityType) => void;
  onSaveSummary?: (
    sessionId: string,
    payload: { summary: string; blocked: boolean; closesIssues: number[] },
  ) => void;
  onStartNudge?: (nudge: NudgeDTO) => void;
  onDismissNudge?: (nudge: NudgeDTO) => void;
  onStartOffTask?: () => void;
}

const noop = () => {};

export default function ProgrammerScreen({
  login,
  syncedAgo,
  date,
  nudge,
  tasks,
  sessionsByTask,
  onStart = noop,
  onStop = noop,
  onOverrideActivity = noop,
  onSaveSummary = noop,
  onStartNudge = noop,
  onDismissNudge = noop,
  onStartOffTask = noop,
}: ProgrammerScreenProps) {
  return (
    <div className="min-h-full bg-bg text-text font-sans">
      {/* Header */}
      <header className="border-b border-hair px-6 py-4 flex items-center justify-between">
        <h1 className="text-sm font-medium text-text">{date}</h1>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-text2 px-2 py-1 rounded border border-hair">
            <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden />
            github · {login}
          </span>
          <span className="font-mono text-xs text-text3">synced {syncedAgo} ago</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6">
        {/* Detected-branch nudge banner */}
        {nudge && (
          <div className="mb-5 rounded-lg border border-brass/40 bg-brass/5 px-4 py-3 flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-brass shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text">
                Detected work with no session
              </div>
              <div className="font-mono text-xs text-text2 truncate">
                {nudge.repoFullName}
                {nudge.branch ? ` · ${nudge.branch}` : ''} — {nudge.detail}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onStartNudge(nudge)}
              className="font-mono text-xs px-3 h-7 rounded bg-brass text-bg font-medium hover:opacity-90 shrink-0"
            >
              Start
            </button>
            <button
              type="button"
              onClick={() => onDismissNudge(nudge)}
              className="font-mono text-xs px-2.5 h-7 rounded border border-hair text-text3 hover:text-text hover:border-hair2 shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Task list */}
        <div className="rounded-lg border border-hair bg-panel overflow-hidden">
          {tasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text3">
              No assigned tasks.
            </div>
          ) : (
            tasks.map((task) => {
              const s = sessionsByTask[task.id] ?? { state: 'idle' as TaskRowState };
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  state={s.state}
                  session={s.session}
                  draft={s.draft}
                  commits={s.commits}
                  onStart={onStart}
                  onStop={onStop}
                  onOverrideActivity={onOverrideActivity}
                  onSaveSummary={onSaveSummary}
                />
              );
            })
          )}
        </div>

        {/* Off-task session button */}
        <button
          type="button"
          onClick={onStartOffTask}
          className="mt-4 w-full rounded-lg border border-dashed border-hair2 text-text3 hover:text-text2 hover:border-text3 py-3 font-mono text-xs"
        >
          + off-task session
        </button>

        {/* Footer hint */}
        <p className="mt-6 text-center font-mono text-[11px] text-text3">
          sessions auto-detect activity from commits · stop to wrap with a one-line summary
        </p>
      </main>
    </div>
  );
}
