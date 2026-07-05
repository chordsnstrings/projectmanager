import { useEffect, useState } from 'react';
import type {
  ActivityType,
  CommitDTO,
  DraftSummary,
  NudgeDTO,
  Productivity,
  QuestionDTO,
  SessionDTO,
  TaskDTO,
} from '@cadence/shared';
import { fmtDuration } from '../lib/format';
import TaskRow, { type TaskRowState } from './TaskRow';
import { Logo } from '../components/Logo';
import InstallButton from '../components/InstallButton';
import NotificationToggle from '../components/NotificationToggle';
import { GuideButton } from '../GuideModal';
import { liveElapsed } from '../lib/format';
import QuestionsForDev from './QuestionsForDev';
import TaskPool from './TaskPool';
import AddActivity from './AddActivity';

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
  /** the current user's team activity keys (one-tap cycle) */
  activityKeys?: string[];
  /** claimable unassigned team tasks */
  pool?: TaskDTO[];
  onClaim?: (taskId: string) => void;
  onCreateTask?: (title: string, estimateMinutes: number | null) => void;
  tasks: TaskDTO[];
  /** keyed by task id */
  sessionsByTask: Record<string, TaskSessionState>;
  onStart?: (taskId: string, intent?: string) => void;
  /** more pages of tasks exist server-side */
  moreTasks?: boolean;
  onLoadMoreTasks?: () => void;
  onStop?: (sessionId: string) => void;
  onOverrideActivity?: (sessionId: string, activity: ActivityType) => void;
  onSaveSummary?: (
    sessionId: string,
    payload: { summary: string; blocked: boolean; closesIssues: number[] },
  ) => void;
  onStartNudge?: (nudge: NudgeDTO, intent?: string) => void;
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
  onEditSummary?: (sessionId: string, summary: string) => void;
  onStartLabeled?: (label: string) => void;
  onBackfill?: (label: string, startedAt: string, endedAt: string) => void;
  stopOnCommit?: boolean;
  onToggleStopOnCommit?: () => void;
  /** open the dev's own day-timeline (self-review) */
  onOpenDay?: () => void;
  /** open the dev's own progress / completion view */
  onOpenProgress?: () => void;
  /** today + this-week productivity summary for the board strip */
  productivity?: Productivity | null;
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

/** Detected-work nudge — on Start, capture intent (what they're doing) like the play button. */
function NudgeBanner({
  nudge,
  onStartNudge,
  onDismissNudge,
}: {
  nudge: NudgeDTO;
  onStartNudge: (nudge: NudgeDTO, intent?: string) => void;
  onDismissNudge: (nudge: NudgeDTO) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [intent, setIntent] = useState('');
  const begin = () => {
    const t = intent.trim();
    if (!t) return;
    onStartNudge(nudge, t);
    setStarting(false);
    setIntent('');
  };
  return (
    <div className="rounded-xl border border-brass/30 bg-brass/[0.06] px-4 py-3.5 flex flex-col gap-3 animate-fade-in">
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-brass shrink-0 animate-pulse" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text font-medium tracking-tightish">Detected work with no session</div>
          <div className="font-mono text-xs text-text2 truncate mt-0.5">
            {nudge.repoFullName}
            {nudge.branch ? ` · ${nudge.branch}` : ''} — {nudge.detail}
          </div>
        </div>
        {!starting && (
          <button type="button" onClick={() => setStarting(true)} className="btn btn-sm btn-primary shrink-0">
            Start
          </button>
        )}
        <button type="button" onClick={() => onDismissNudge(nudge)} className="btn btn-sm btn-quiet shrink-0">
          Dismiss
        </button>
      </div>
      {starting && (
        <div className="flex flex-col gap-1.5">
          <span className="label">what are you working on?</span>
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={intent}
              maxLength={300}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') begin();
                if (e.key === 'Escape') setStarting(false);
              }}
              placeholder="e.g. picking up the API error-handling branch"
              className="field h-9 px-3 text-sm flex-1"
            />
            <button type="button" onClick={() => setStarting(false)} className="btn btn-sm btn-ghost">
              cancel
            </button>
            <button type="button" onClick={begin} disabled={!intent.trim()} className="btn btn-sm btn-primary">
              Start
            </button>
          </div>
          <span className="font-mono text-[10px] text-text3 self-end">{intent.length}/300</span>
        </div>
      )}
    </div>
  );
}

function ProdStat({ label, value, tone = 'text-text' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`font-mono text-base mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}

export default function ProgrammerScreen({
  login,
  syncedAgo,
  date,
  nudge,
  activityKeys,
  pool = [],
  onClaim = noop,
  onCreateTask = noop,
  tasks,
  sessionsByTask,
  onStart = noop,
  moreTasks = false,
  onLoadMoreTasks = noop,
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
  onStartLabeled = noop,
  onBackfill = noop,
  stopOnCommit = false,
  onToggleStopOnCommit = noop,
  onOpenDay = noop,
  onOpenProgress = noop,
  productivity = null,
}: ProgrammerScreenProps) {
  return (
    <div className="min-h-full text-text font-sans">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-hair bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70 px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Logo size={20} />
          <span className="hidden sm:inline text-sm font-medium text-text2 tracking-tightish truncate">{date}</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button type="button" data-tour="myday" onClick={() => onOpenDay()} className="btn btn-sm btn-ghost" title="review your day timeline">
            My day
          </button>
          <button type="button" onClick={() => onOpenProgress()} className="btn btn-sm btn-ghost" title="your progress & completed work">
            Progress
          </button>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-text2 px-2.5 h-8 rounded-lg border border-hair">
            <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden />
            <span className="hidden sm:inline text-text3">github · </span>{login}
          </span>
          <button
            type="button"
            onClick={() => onRefresh()}
            disabled={syncing}
            className="btn btn-sm btn-quiet"
            title="re-sync your projects from GitHub"
          >
            <span className={syncing ? 'animate-spin' : ''} aria-hidden>↻</span>
            <span className="hidden sm:inline">{syncing ? 'syncing…' : `synced ${syncedAgo}`}</span>
          </button>
          <GuideButton />
          <NotificationToggle />
          <InstallButton />
          <button
            type="button"
            onClick={() => onSignOut()}
            className="btn btn-sm btn-ghost"
          >
            sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-7 sm:py-8 flex flex-col gap-5">
        {/* Productivity strip — your actual output today + this week */}
        {productivity && (
          <button
            type="button"
            data-tour="prod"
            onClick={() => onOpenProgress()}
            className="card px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-left hover:bg-surface/40 transition-colors"
            title="open your progress"
          >
            <ProdStat label="today · active" value={fmtDuration(productivity.today.activeMinutes)} />
            <ProdStat label="today · done" value={String(productivity.today.completed)} tone="text-success" />
            <ProdStat label="7d · active" value={fmtDuration(productivity.week.activeMinutes)} />
            <ProdStat label="7d · done" value={String(productivity.week.completed)} tone="text-success" />
          </button>
        )}

        {/* Open questions the dev must answer (gates next completion) */}
        <QuestionsForDev questions={questions} onAnswer={onAnswerQuestion} />

        {/* Team task pool — claim work or add your own */}
        <TaskPool pool={pool} onClaim={onClaim} onCreateTask={onCreateTask} />

        {/* Detected-branch nudge banner */}
        {nudge && <NudgeBanner nudge={nudge} onStartNudge={onStartNudge} onDismissNudge={onDismissNudge} />}

        {/* Running off-task sessions — only place they can be stopped */}
        {offTaskRunning.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-hair label">
              off-task running · {offTaskRunning.length}
            </div>
            {offTaskRunning.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-hair last:border-b-0"
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
                  className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-hair2 text-danger hover:bg-danger/10 transition-colors"
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
        <div className="card overflow-hidden" data-tour="tasks">
          {tasks.length === 0 ? (
            <div className="px-6 py-14 text-center flex flex-col items-center">
              <span className="w-10 h-10 rounded-full border border-hair2 inline-flex items-center justify-center text-text3 mb-4" aria-hidden>
                <span className="text-base leading-none">⌥</span>
              </span>
              <div className="text-sm text-text font-medium mb-1.5">No projects synced yet</div>
              <p className="text-xs text-text3 leading-relaxed max-w-sm mx-auto mb-5">
                Cadence pulls your assigned issues, open PRs, and recently-active repos from
                GitHub. If this stays empty, you may have no recent activity on accessible repos.
              </p>
              <button
                type="button"
                onClick={() => onRefresh()}
                disabled={syncing}
                className="btn btn-md btn-ghost"
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
                  onRefresh={onRefresh}
                  activityKeys={activityKeys}
                />
              );
            })
          )}
          {moreTasks && (
            <button
              type="button"
              onClick={() => onLoadMoreTasks()}
              className="w-full py-3 font-mono text-[11px] text-text3 hover:text-text2 hover:bg-surface/40 transition-colors border-t border-hair"
            >
              show more tasks ↓
            </button>
          )}
        </div>

        {/* Non-git activity: quick-start labels + same-day backfill */}
        <div data-tour="addactivity">
          <AddActivity onStartLabeled={onStartLabeled} onBackfill={onBackfill} />
        </div>

        {/* Footer: settings + hint */}
        <div className="mt-2 pt-5 border-t border-hair flex flex-col items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleStopOnCommit}
            role="switch"
            aria-checked={stopOnCommit}
            className="inline-flex items-center gap-2 font-mono text-[11px] text-text3 hover:text-text2 transition-colors"
          >
            <span
              className={`relative inline-block w-7 h-4 rounded-full border transition-colors ${
                stopOnCommit ? 'bg-activity-coding/25 border-activity-coding/60' : 'border-hair2'
              }`}
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                  stopOnCommit ? 'left-3.5 bg-activity-coding' : 'left-0.5 bg-text3'
                }`}
              />
            </span>
            auto-stop session on commit
          </button>
          <p className="text-center font-mono text-[11px] text-text3">
            one tap to start · one tap to end · summary auto-drafted from commits
          </p>
        </div>
      </main>
    </div>
  );
}
