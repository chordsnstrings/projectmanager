import { useEffect, useState } from 'react';
import type {
  ActivityType,
  CommitDTO,
  DraftSummary,
  NudgeDTO,
  QuestionDTO,
  SessionDTO,
  TaskDTO,
} from '@cadence/shared';
import TaskRow, { type TaskRowState } from './TaskRow';
import { Logo } from '../components/Logo';
import { liveElapsed } from '../lib/format';
import QuestionsForDev from './QuestionsForDev';

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
  onSignOut?: () => void;
  onRefresh?: () => void;
  onRename?: (taskId: string, title: string) => void;
  syncing?: boolean;
  /** running off-task sessions (no task row to control them from) */
  offTaskRunning?: SessionDTO[];
  /** stop a session directly (no wrap-up panel) — used for off-task */
  onStopOffTask?: (sessionId: string) => void;
  /** open questions the dev must answer (gates next completion) */
  questions?: QuestionDTO[];
  onAnswerQuestion?: (id: string, answer: string) => void;
}

function RunningTimer({ startedAt }: { startedAt: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="font-mono text-sm text-text tabular-nums">{liveElapsed(startedAt)}</span>;
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
  onSignOut = noop,
  onRefresh = noop,
  onRename = noop,
  syncing = false,
  offTaskRunning = [],
  onStopOffTask = noop,
  questions = [],
  onAnswerQuestion = noop,
}: ProgrammerScreenProps) {
  return (
    <div className="min-h-full bg-bg text-text font-sans">
      {/* Header */}
      <header className="border-b border-hair px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Logo size={20} />
          <span className="hidden sm:inline text-sm font-medium text-text2">{date}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-text2 px-2 py-1 rounded border border-hair">
            <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden />
            <span className="hidden sm:inline">github · </span>{login}
          </span>
          <button
            type="button"
            onClick={() => onRefresh()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-text3 hover:text-text px-2.5 h-8 rounded border border-hair hover:border-hair2 disabled:opacity-60"
            title="re-sync your projects from GitHub"
          >
            <span className={syncing ? 'animate-spin' : ''} aria-hidden>↻</span>
            <span className="hidden sm:inline">{syncing ? 'syncing…' : `synced ${syncedAgo}`}</span>
          </button>
          <button
            type="button"
            onClick={() => onSignOut()}
            className="font-mono text-xs text-text3 hover:text-text px-2.5 h-8 rounded border border-hair hover:border-hair2"
          >
            sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {/* Open questions the dev must answer (gates next completion) */}
        <QuestionsForDev questions={questions} onAnswer={onAnswerQuestion} />

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

        {/* Running off-task sessions — only place they can be stopped */}
        {offTaskRunning.length > 0 && (
          <div className="mb-4 rounded-lg border border-hair2 bg-panel overflow-hidden">
            <div className="px-4 py-2 border-b border-hair font-mono text-[11px] uppercase tracking-wide text-text3">
              off-task running · {offTaskRunning.length}
            </div>
            {offTaskRunning.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-hair last:border-b-0"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0 animate-pulse" aria-hidden />
                <span className="text-sm text-text2 flex-1 truncate">
                  {s.offTaskLabel ?? 'off-task'}
                  {s.intent ? ` · ${s.intent}` : ''}
                </span>
                <RunningTimer startedAt={s.startedAt} />
                <button
                  type="button"
                  onClick={() => onStopOffTask(s.id)}
                  className="w-9 h-9 inline-flex items-center justify-center rounded border border-hair2 text-danger hover:bg-surface2"
                  title="stop session"
                  aria-label="stop off-task session"
                >
                  <span className="text-xs leading-none">■</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Task list */}
        <div className="rounded-lg border border-hair bg-panel overflow-hidden">
          {tasks.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="text-sm text-text2 mb-1">No projects synced yet</div>
              <p className="text-xs text-text3 max-w-sm mx-auto mb-4">
                Cadence pulls your assigned issues, open PRs, and recently-active repos from
                GitHub. If this stays empty, you may have no recent activity on accessible repos.
              </p>
              <button
                type="button"
                onClick={() => onRefresh()}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 font-mono text-xs px-3 h-9 rounded border border-hair2 text-text2 hover:text-text hover:bg-surface2 disabled:opacity-60"
              >
                <span className={syncing ? 'animate-spin' : ''} aria-hidden>↻</span>
                {syncing ? 'syncing…' : 'Refresh from GitHub'}
              </button>
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
                  onRename={onRename}
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
