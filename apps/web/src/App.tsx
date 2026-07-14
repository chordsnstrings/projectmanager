import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivityType,
  DayTimeline as DayTimelineDTO,
  DraftSummary,
  FlagDTO,
  Me,
  NudgeDTO,
  Paginated,
  QuestionDTO,
  SessionDTO,
  TaskDTO,
  TeamDashboard,
  TeamDay as TeamDayDTO,
  Trends as TrendsDTO,
  Progress as ProgressDTO,
  Productivity as ProductivityDTO,
  ManagedTask as ManagedTaskDTO,
  MemberLite as MemberLiteDTO,
  RepoLite as RepoLiteDTO,
  TeamDTO as TeamDTOAlias,
  PulseInsights,
  MeetingMinutesBody,
  MeetingDTO,
  CreateMeetingBody,
} from '@cadence/shared';
import { activityKeysFor } from './lib/activity';
import { usePoll } from './lib/usePoll';
import { api, ApiError } from './lib/api';
import { relativeTime } from './lib/format';
import { downloadTeamCsv } from './lib/csv';
import { Logo } from './components/Logo';
import InstallButton from './components/InstallButton';
import NotificationToggle from './components/NotificationToggle';
import Onboarding from './Onboarding';
import UpdateModal from './UpdateModal';
import UpdateToast from './UpdateToast';
import CheckinModal from './CheckinModal';
import GuideModal, { GuideButton } from './GuideModal';
import Walkthrough from './Walkthrough';
import Toasts, { toast } from './components/Toasts';
import BoardSkeleton, { ListSkeleton } from './components/Skeleton';
import ConfirmDialogHost, { confirmDialog } from './components/ConfirmDialog';
import ProgrammerScreen, { type TaskSessionState } from './programmer/ProgrammerScreen';
import MeetingMinutesModal from './programmer/MeetingMinutesModal';
import TeamOverview from './admin/TeamOverview';
import TeamDay from './admin/TeamDay';
import DayTimeline from './admin/DayTimeline';
import Trends from './admin/Trends';
import ProgressView from './admin/ProgressView';
import CompletionLog from './admin/CompletionLog';
import TasksPanel from './admin/TasksPanel';
import FlagsPanel from './admin/FlagsPanel';
import AskAboutTask from './admin/AskAboutTask';
import SendDigestButton from './admin/SendDigestButton';
import RunLoginCheckButton from './admin/RunLoginCheckButton';
import QuestionsPanel from './admin/QuestionsPanel';
import PulsePanel from './admin/PulsePanel';
import MeetingsPanel from './admin/MeetingsPanel';

type AuthState = { kind: 'loading' } | { kind: 'anon' } | { kind: 'authed'; me: Me };

async function signOut() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/';
}

// A `meeting` session can't stop until its minutes are filed — the server 409s.
// Detect that so any stop entry point can open the Minutes modal instead of a
// raw error (covers old cached bundles + every stop path).
function isMeetingGate(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && (e.body as { error?: string } | undefined)?.error === 'meeting_minutes_required';
}

export interface Route {
  path: string;
  params: URLSearchParams;
  navigate: (to: string, replace?: boolean) => void;
}

/** Tiny history-based router (no dependency). Server serves index.html for all
 *  non-API GETs, so these slugs deep-link + survive refresh. Admin pages live
 *  under /admin/* to avoid colliding with API routes like /flags, /questions. */
function useRoute(): Route {
  const [loc, setLoc] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setLoc(window.location.pathname + window.location.search);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((to: string, replace = false) => {
    if (to === window.location.pathname + window.location.search) return;
    const prevPath = window.location.pathname;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
    setLoc(to);
    // New page (not just a query tweak like ?date=): start at the top.
    if (to.split('?')[0] !== prevPath) window.scrollTo(0, 0);
  }, []);
  const q = loc.indexOf('?');
  const path = q === -1 ? loc : loc.slice(0, q);
  const params = new URLSearchParams(q === -1 ? '' : loc.slice(q + 1));
  return { path, params, navigate };
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const route = useRoute();

  useEffect(() => {
    api<Me>('/me')
      .then((me) => {
        setAuth({ kind: 'authed', me });
        // Keep the server's notion of the user's timezone in sync with the
        // browser so day boundaries, idle math and digests are in local time.
        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (browserTz && browserTz !== me.timezone) {
          void api('/me/settings', { method: 'PATCH', body: JSON.stringify({ timezone: browserTz }) }).catch(
            () => {},
          );
        }
      })
      .catch(() => setAuth({ kind: 'anon' }));
  }, []);

  // Land on the right slug once the role is known.
  useEffect(() => {
    if (auth.kind !== 'authed' || !auth.me.onboardingComplete) return;
    const p = route.path;
    if (auth.me.role === 'dev') {
      if (!p.startsWith('/board')) route.navigate('/board', true);
    } else if (!p.startsWith('/admin')) {
      route.navigate('/admin/team', true);
    }
  }, [auth, route.path, route.navigate]);

  if (auth.kind === 'loading') return <Splash>connecting…</Splash>;
  if (auth.kind === 'anon') return <SignIn />;
  // First-run: must pick a team before anything else. The walkthrough then
  // auto-runs on the board (tourSeen is still false for a brand-new user).
  if (!auth.me.onboardingComplete) {
    return <Onboarding onDone={(me) => setAuth({ kind: 'authed', me })} />;
  }
  // One-time "what's new" modal, acknowledged per user.
  const ackVersion = (version: string) => {
    if (auth.kind !== 'authed') return;
    setAuth({ kind: 'authed', me: { ...auth.me, lastSeenVersion: version } });
    void api('/me/seen', { method: 'POST', body: JSON.stringify({ version }) }).catch(() => {});
  };
  // Owners and leads use the admin app (team-scoped server-side); devs the board.
  const screen =
    auth.me.role === 'dev' ? <DevApp me={auth.me} route={route} /> : <AdminApp me={auth.me} route={route} />;
  return (
    <>
      {screen}
      {/* Hold the check-in back until the walkthrough has run — one overlay at a time. */}
      {auth.me.tourSeen && <CheckinModal me={auth.me} />}
      <Walkthrough
        me={auth.me}
        onSeen={() => setAuth({ kind: 'authed', me: { ...auth.me, tourSeen: true } })}
      />
      <GuideModal me={auth.me} />
      {auth.me.tourSeen && <UpdateModal me={auth.me} onAck={ackVersion} />}
      <UpdateToast />
      <Toasts />
      <ConfirmDialogHost />
    </>
  );
}

// ── Chrome ──────────────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-full text-text font-sans overflow-x-hidden">{children}</div>;
}
function Splash({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <div className="h-screen grid place-items-center gap-4 text-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <Logo size={26} />
          <div className="flex items-center gap-2 font-mono text-text3 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-brass/70 animate-pulse" aria-hidden />
            {children}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function SignIn() {
  return (
    <Shell>
      <div className="min-h-screen grid place-items-center p-6">
        <div className="card p-8 sm:p-10 text-center max-w-sm w-full animate-fade-in">
          <div className="mb-5 flex justify-center">
            <Logo size={30} />
          </div>
          <p className="text-text2 text-sm leading-relaxed mb-7 max-w-[26ch] mx-auto">
            Sessions are the clock. Git is the truth. Sign in to see your work.
          </p>
          <a
            href="/auth/github"
            className="btn btn-lg btn-primary w-full text-sm"
          >
            Connect GitHub
          </a>
        </div>
      </div>
    </Shell>
  );
}

// ── Programmer ────────────────────────────────────────────────────────────────
function DevApp({ me, route }: { me: Me; route: Route }) {
  const { path, params, navigate } = route;
  const view: 'board' | 'day' | 'progress' = path.startsWith('/board/day')
    ? 'day'
    : path.startsWith('/board/progress')
      ? 'progress'
      : 'board';
  const dayDate = params.get('date') ?? todayStr();
  const setDayDate: React.Dispatch<React.SetStateAction<string>> = (upd) => {
    const next = typeof upd === 'function' ? (upd as (d: string) => string)(dayDate) : upd;
    navigate(`/board/day${next === todayStr() ? '' : `?date=${next}`}`);
  };

  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [active, setActive] = useState<SessionDTO[]>([]);
  const [nudges, setNudges] = useState<NudgeDTO[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<QuestionDTO[]>([]);
  const [day, setDay] = useState<DayTimelineDTO | null>(null);
  const [productivity, setProductivity] = useState<ProductivityDTO | null>(null);
  const [progress, setProgress] = useState<ProgressDTO | null>(null);
  const [pool, setPool] = useState<TaskDTO[]>([]);
  const [tasksCursor, setTasksCursor] = useState<string | null>(null);
  const [myMeetings, setMyMeetings] = useState<MeetingDTO[]>([]);
  const [meetingToStop, setMeetingToStop] = useState<SessionDTO | null>(null);
  const [stopOnCommit, setStopOnCommit] = useState(me.stopOnCommit);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [t, a, n, q, prod, pl, mtg] = await Promise.all([
      api<Paginated<TaskDTO>>('/tasks').catch(() => ({ items: [] as TaskDTO[], nextCursor: null })),
      api<SessionDTO[]>('/sessions/active').catch(() => [] as SessionDTO[]),
      api<NudgeDTO[]>('/nudges').catch(() => [] as NudgeDTO[]),
      api<QuestionDTO[]>('/questions?status=open').catch(() => [] as QuestionDTO[]),
      api<ProductivityDTO>('/me/productivity').catch(() => null),
      api<Paginated<TaskDTO>>('/tasks/pool').then((p) => p.items).catch(() => [] as TaskDTO[]),
      api<MeetingDTO[]>('/me/meetings').catch(() => [] as MeetingDTO[]),
    ]);
    setTasks(t.items);
    setTasksCursor(t.nextCursor);
    setActive(a);
    setNudges(n);
    setQuestions(q);
    setProductivity(prod);
    setPool(pl);
    setMyMeetings(mtg);
    setLoaded(true);
  }, []);

  const onLoadMoreTasks = useCallback(async () => {
    if (!tasksCursor) return;
    const p = await api<Paginated<TaskDTO>>(`/tasks?cursor=${tasksCursor}`).catch(() => null);
    if (!p) return;
    setTasks((prev) => [...prev, ...p.items.filter((t) => !prev.some((x) => x.id === t.id))]);
    setTasksCursor(p.nextCursor);
  }, [tasksCursor]);

  const onClaim = useCallback(
    async (taskId: string) => {
      try {
        await api(`/tasks/${taskId}/claim`, { method: 'POST', body: '{}' });
      } catch (e) {
        const body = e instanceof ApiError ? (e.body as { error?: string; readiness?: { score: number; missing: string[] } } | undefined) : undefined;
        if (e instanceof ApiError && e.status === 409 && body?.error === 'not_specified') {
          const r = body.readiness;
          const ok = await confirmDialog({
            title: `This task looks under-specified (${r?.score ?? 0}/100)`,
            body: r?.missing?.length ? `Missing: ${r.missing.join('; ')}` : undefined,
            confirmLabel: 'Pick it up anyway',
          });
          if (ok) {
            await api(`/tasks/${taskId}/claim`, { method: 'POST', body: JSON.stringify({ override: true }) }).catch(
              () => toast('Couldn’t pick up the task', 'error'),
            );
          }
        } else if (e instanceof ApiError && e.status === 409) {
          toast('Already picked up by someone else', 'info');
        } else {
          toast('Couldn’t pick up the task', 'error');
        }
      }
      await refresh();
    },
    [refresh],
  );
  const onCreateTask = useCallback(
    async (title: string, estimateMinutes: number | null) => {
      await api('/tasks', { method: 'POST', body: JSON.stringify({ title, estimateMinutes, assigneeUserId: me.id }) }).catch(
        () => toast('Couldn’t create the task', 'error'),
      );
      await refresh();
    },
    [refresh, me.id],
  );

  // Mark one of your own tasks complete (server allows the assignee to set done).
  const onMarkDone = useCallback(
    async (taskId: string) => {
      await api(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })
        .then(() => toast('Task marked complete', 'success'))
        .catch(() => toast('Couldn’t complete the task', 'error'));
      await refresh();
    },
    [refresh],
  );

  const onAnswerQuestion = useCallback(
    async (id: string, answer: string) => {
      await api(`/questions/${id}/answer`, { method: 'POST', body: JSON.stringify({ answer }) }).catch(
        () => toast('Couldn’t send your answer — try again', 'error'),
      );
      await refresh();
    },
    [refresh],
  );

  const doSync = useCallback(async () => {
    setSyncing(true);
    try {
      await api('/tasks/refresh', { method: 'POST' });
      setLastSync(Date.now());
    } catch {
      /* ignore — show whatever's already synced */
    } finally {
      await refresh();
      setSyncing(false);
    }
  }, [refresh]);

  useEffect(() => {
    void doSync();
  }, [doSync]);
  usePoll(refresh, 15000); // near-live for questions; pauses while tab hidden

  // "My day": the dev's own timeline (live today, or any past day) for self-review.
  const loadDay = useCallback(
    () => api<DayTimelineDTO>(`/dashboard/user/${me.id}/day?date=${dayDate}`).then(setDay).catch(() => setDay(null)),
    [me.id, dayDate],
  );
  useEffect(() => {
    if (view !== 'day') return;
    void loadDay();
  }, [view, loadDay]);
  usePoll(loadDay, 30000, view === 'day' && dayDate === todayStr()); // keep today's view current

  // The runner can turn their own meeting's action items into team tasks.
  const onCreateTaskFromItem = useCallback(
    async (itemId: string) => {
      await api(`/meeting-items/${itemId}/task`, { method: 'POST', body: '{}' })
        .then(() => toast('Task created from the minutes', 'success'))
        .catch(() => toast('Couldn’t create the task', 'error'));
      await loadDay();
      await refresh();
    },
    [loadDay, refresh],
  );

  useEffect(() => {
    if (view !== 'progress') return;
    void api<ProgressDTO>(`/dashboard/user/${me.id}/progress`).then(setProgress).catch(() => setProgress(null));
  }, [view, me.id]);

  // Live "stop on commit": while a task session is running, poll just that repo
  // for new commits (no webhooks needed) and auto-stop within ~30s.
  const watchCommits = stopOnCommit && active.some((s) => s.taskId && s.isOpen);
  useEffect(() => {
    if (!watchCommits) return;
    let cancelled = false;
    const run = async () => {
      await api('/sessions/sync-commits', { method: 'POST' }).catch(() => {});
      if (!cancelled) await refresh();
    };
    void run();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void run();
    }, 25000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [watchCommits, refresh]);

  // Make a newly-arrived question impossible to miss: jump to it + flag the tab.
  const prevQids = useRef<Set<string>>(new Set());
  useEffect(() => {
    const hasNew = questions.some((q) => !prevQids.current.has(q.id));
    prevQids.current = new Set(questions.map((q) => q.id));
    if (hasNew) window.scrollTo({ top: 0, behavior: 'smooth' });
    document.title = questions.length > 0 ? `(${questions.length}) Cadence · question` : 'Cadence';
  }, [questions]);

  const onStart = useCallback(
    async (taskId: string, intent?: string) => {
      await api<SessionDTO>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ taskId, intent: intent?.trim() ? intent.trim().slice(0, 300) : undefined }),
      }).catch(() => toast('Couldn’t start the session', 'error'));
      await refresh();
    },
    [refresh],
  );

  // One click to end: auto-saves the drafted one-line summary; editable later.
  const onStop = useCallback(
    async (sessionId: string) => {
      let summary: string | undefined;
      try {
        const draft = await api<DraftSummary>(`/sessions/${sessionId}/draft-summary`);
        summary = draft.summary;
      } catch {
        /* no draft (e.g. off-task) */
      }
      try {
        await api<SessionDTO>(`/sessions/${sessionId}/stop`, {
          method: 'POST',
          body: JSON.stringify(summary ? { summary } : {}),
        });
      } catch (e) {
        if (isMeetingGate(e)) {
          const s = active.find((x) => x.id === sessionId);
          if (s) {
            setMeetingToStop(s);
            return;
          }
        }
        toast('Couldn’t stop the session — it’s still running', 'error');
      }
      await refresh();
    },
    [refresh, active],
  );

  const onEditSummary = useCallback(
    async (sessionId: string, summary: string) => {
      await api(`/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ summary }) }).catch(
        () => toast('Couldn’t save the summary', 'error'),
      );
      await refresh();
    },
    [refresh],
  );

  const onOverrideActivity = useCallback(
    async (sessionId: string, activity: ActivityType) => {
      const now = new Date();
      const start = new Date(now.getTime() - 5 * 60000);
      await api(`/sessions/${sessionId}/activity`, {
        method: 'POST',
        body: JSON.stringify({ type: activity, startedAt: start.toISOString(), endedAt: now.toISOString() }),
      }).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  const onStopOffTask = useCallback(
    async (sessionId: string) => {
      try {
        await api<SessionDTO>(`/sessions/${sessionId}/stop`, { method: 'POST', body: '{}' });
      } catch (e) {
        if (isMeetingGate(e)) {
          const s = active.find((x) => x.id === sessionId);
          if (s) {
            setMeetingToStop(s);
            return;
          }
        }
        toast('Couldn’t stop the session', 'error');
      }
      await refresh();
    },
    [refresh, active],
  );

  // Start a meeting session for a scheduled meeting — intent = its title, so the
  // MoM modal (required to stop) opens for this meeting when it ends.
  const onStartMeeting = useCallback(
    async (title: string) => {
      await api<SessionDTO>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ offTaskLabel: 'meeting', intent: title.slice(0, 300) }),
      }).catch(() => toast('Couldn’t start the meeting', 'error'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await refresh();
    },
    [refresh],
  );

  // Record a meeting's minutes and stop it (server does both atomically). Throws
  // on failure so the modal can keep itself open and show an error.
  const onStopMeeting = useCallback(
    async (sessionId: string, minutes: MeetingMinutesBody) => {
      await api(`/sessions/${sessionId}/meeting-minutes`, { method: 'POST', body: JSON.stringify(minutes) });
      toast('Meeting minutes saved', 'success');
      await refresh();
    },
    [refresh],
  );

  // Discard a meeting started by mistake — no minutes, kept out of tracked time.
  const onDiscardMeeting = useCallback(
    async (sessionId: string) => {
      await api(`/sessions/${sessionId}/discard`, { method: 'POST', body: '{}' });
      toast('Meeting discarded', 'success');
      await refresh();
    },
    [refresh],
  );

  const onStartOffTask = useCallback(
    async (intent?: string) => {
      await api<SessionDTO>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ offTaskLabel: 'off-task', intent: intent?.trim() ? intent.trim().slice(0, 300) : undefined }),
      });
      await refresh();
    },
    [refresh],
  );

  // Start a labelled non-git activity now (meeting/research/…).
  const onStartLabeled = useCallback(
    async (label: string) => {
      await api<SessionDTO>('/sessions', { method: 'POST', body: JSON.stringify({ offTaskLabel: label }) });
      await refresh();
    },
    [refresh],
  );

  // Backfill a completed non-git block for TODAY (e.g. a meeting 10:00–11:00).
  const onBackfill = useCallback(
    async (label: string, startedAt: string, endedAt: string) => {
      await api<SessionDTO>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ offTaskLabel: label, startedAt, endedAt }),
      }).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  const onToggleStopOnCommit = useCallback(async () => {
    const next = !stopOnCommit;
    setStopOnCommit(next);
    await api('/me/settings', { method: 'PATCH', body: JSON.stringify({ stopOnCommit: next }) }).catch(() => {});
  }, [stopOnCommit]);

  const onStartNudge = useCallback(
    async (n: NudgeDTO, intent?: string) => {
      if (n.suggestedTaskId) await onStart(n.suggestedTaskId, intent);
      else await onStartOffTask(intent);
    },
    [onStart, onStartOffTask],
  );

  const onRename = useCallback(
    async (taskId: string, title: string) => {
      await api<TaskDTO>(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ title }) }).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  if (!loaded)
    return (
      <Shell>
        <BoardSkeleton />
      </Shell>
    );

  // Self-review screens: "My day" timeline + "Progress".
  if (view === 'day' || view === 'progress') {
    const subTab = (to: string, key: string, label: string) => (
      <button
        onClick={() => navigate(to)}
        className={`font-mono text-xs px-3.5 h-8 transition-colors ${view === key ? 'bg-surface2/80 text-text' : 'text-text3 hover:text-text2'} ${key !== 'day' ? 'border-l border-hair' : ''}`}
      >
        {label}
      </button>
    );
    return (
      <Shell>
        <header className="sticky top-0 z-20 border-b border-hair bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70 px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Logo size={20} />
            <button onClick={() => navigate('/board')} className="btn btn-sm btn-ghost">← board</button>
          </div>
          <div className="flex items-center gap-1.5">
            <InstallButton />
            <button onClick={signOut} className="btn btn-sm btn-ghost">sign out</button>
          </div>
        </header>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-lg border border-hair overflow-hidden">
              {subTab('/board/day', 'day', 'My day')}
              {subTab('/board/progress', 'progress', 'Progress')}
            </div>
            {view === 'day' && <DateNav date={dayDate} setDate={setDayDate} />}
          </div>
          {view === 'day' ? (
            day ? (
              <>
                <DayTimeline data={day} onCreateTaskFromItem={onCreateTaskFromItem} />
                <p className="text-center font-mono text-[11px] text-text3">
                  active = real time worked (overlaps counted once) · task hrs = effort across tasks
                </p>
              </>
            ) : (
              <Loading>loading your day…</Loading>
            )
          ) : progress ? (
            <>
              <ProgressView data={progress} />
              <CompletionLog />
            </>
          ) : (
            <Loading>loading your progress…</Loading>
          )}
        </div>
      </Shell>
    );
  }

  const sessionsByTask: Record<string, TaskSessionState> = {};
  for (const s of active) if (s.taskId) sessionsByTask[s.taskId] = { state: 'running', session: s };

  // Every open task-session, with a resolved title — the "running now" bar uses
  // this so a session is always stoppable even if its row isn't in view.
  const taskTitleById = new Map([...tasks, ...pool].map((t) => [t.id, t.title]));
  const runningTasks = active
    .filter((s) => s.taskId && s.isOpen)
    .map((s) => ({ id: s.id, title: taskTitleById.get(s.taskId as string) ?? s.intent ?? 'task', startedAt: s.startedAt }));

  const nudge = nudges.find((n) => !dismissed.has(n.id)) ?? null;
  const syncedAgo = lastSync ? relativeTime(new Date(lastSync).toISOString()) : 'never';

  return (
    <Shell>
      <ProgrammerScreen
        onOpenDay={() => navigate('/board/day')}
        onOpenProgress={() => navigate('/board/progress')}
        productivity={productivity}
        activityKeys={activityKeysFor(me.teamKey)}
        teamKey={me.teamKey}
        pool={pool}
        onClaim={onClaim}
        onCreateTask={onCreateTask}
        login={me.githubLogin}
        syncedAgo={syncedAgo}
        syncing={syncing}
        date={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
        nudge={nudge}
        tasks={tasks}
        sessionsByTask={sessionsByTask}
        moreTasks={tasksCursor != null}
        onLoadMoreTasks={onLoadMoreTasks}
        meId={me.id}
        onMarkDone={onMarkDone}
        meetings={myMeetings}
        onStartMeeting={onStartMeeting}
        onStart={onStart}
        onStop={onStop}
        onEditSummary={onEditSummary}
        onOverrideActivity={onOverrideActivity}
        onStartOffTask={onStartOffTask}
        onStartLabeled={onStartLabeled}
        onBackfill={onBackfill}
        onStartNudge={onStartNudge}
        onDismissNudge={(n) => setDismissed((d) => new Set(d).add(n.id))}
        onRefresh={doSync}
        onRename={onRename}
        onSignOut={signOut}
        runningTasks={runningTasks}
        offTaskRunning={active.filter((s) => !s.taskId && s.isOpen)}
        onStopOffTask={onStopOffTask}
        onStopMeeting={onStopMeeting}
        onDiscardMeeting={onDiscardMeeting}
        questions={questions}
        onAnswerQuestion={onAnswerQuestion}
        stopOnCommit={stopOnCommit}
        onToggleStopOnCommit={onToggleStopOnCommit}
      />
      {/* Global safety net: any meeting-stop that 409s opens the Minutes form. */}
      {meetingToStop && (
        <MeetingMinutesModal
          session={meetingToStop}
          onCancel={() => setMeetingToStop(null)}
          onSubmit={async (id, minutes) => {
            await onStopMeeting(id, minutes);
            setMeetingToStop(null);
          }}
          onDiscard={async (id) => {
            await onDiscardMeeting(id);
            setMeetingToStop(null);
          }}
        />
      )}
    </Shell>
  );
}

// ── Admin ─────────────────────────────────────────────────────────────────────
// Local calendar date (not UTC) — "today" should match the viewer's wall clock.
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function shiftDate(d: string, delta: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(y!, (m! - 1), day! + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

type AdminTab = 'team' | 'tasks' | 'meetings' | 'flags' | 'questions' | 'pulse';

function AdminApp({ me, route }: { me: Me; route: Route }) {
  const { path, params, navigate } = route;
  // Navigation state is derived from the slug.
  const personMatch = path.match(/^\/admin\/u\/([^/]+)\/(day|trends|progress)$/);
  const selectedUser = personMatch ? personMatch[1]! : null;
  const personView: 'day' | 'trends' | 'progress' =
    personMatch && (personMatch[2] === 'trends' || personMatch[2] === 'progress')
      ? (personMatch[2] as 'trends' | 'progress')
      : 'day';
  const tab: AdminTab = path.startsWith('/admin/flags')
    ? 'flags'
    : path.startsWith('/admin/questions')
      ? 'questions'
      : path.startsWith('/admin/tasks')
        ? 'tasks'
        : path.startsWith('/admin/meetings')
          ? 'meetings'
          : path.startsWith('/admin/pulse')
            ? 'pulse'
            : 'team';
  const teamView: 'roster' | 'day' = path.startsWith('/admin/team/day') ? 'day' : 'roster';
  const date = params.get('date') ?? todayStr();
  const isToday = date === todayStr();
  const isOwner = me.role === 'admin';
  // Owner-only team filter (?team=<key>); leads are team-scoped server-side.
  const teamFilter = isOwner ? params.get('team') ?? '' : '';
  const teamQS = teamFilter ? `&team=${teamFilter}` : '';

  const [team, setTeam] = useState<TeamDashboard | null>(null);
  const [teamDay, setTeamDay] = useState<TeamDayDTO | null>(null);
  const [day, setDay] = useState<DayTimelineDTO | null>(null);
  const [trends, setTrends] = useState<TrendsDTO | null>(null);
  const [progress, setProgress] = useState<ProgressDTO | null>(null);
  const [flags, setFlags] = useState<FlagDTO[]>([]);
  const [flagsCursor, setFlagsCursor] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionDTO[]>([]);
  const [managedTasks, setManagedTasks] = useState<ManagedTaskDTO[] | null>(null);
  const [managedCursor, setManagedCursor] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<MeetingDTO[] | null>(null);
  const [pulse, setPulse] = useState<PulseInsights | null>(null);
  const [roster, setRoster] = useState<MemberLiteDTO[]>([]);
  const [repos, setRepos] = useState<RepoLiteDTO[]>([]);
  const [teamsList, setTeamsList] = useState<TeamDTOAlias[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Owner team switcher → rewrites ?team= (preserving ?date=).
  const setTeamFilter = (key: string) => {
    const qs = new URLSearchParams();
    if (date !== todayStr()) qs.set('date', date);
    if (key) qs.set('team', key);
    const s = qs.toString();
    navigate(`${path}${s ? `?${s}` : ''}`);
  };

  // setDate keeps the slug, writing ?date= (dropped when today).
  const setDate: React.Dispatch<React.SetStateAction<string>> = (upd) => {
    const next = typeof upd === 'function' ? (upd as (d: string) => string)(date) : upd;
    navigate(`${path}${next === todayStr() ? '' : `?date=${next}`}`);
  };

  const loadTeam = useCallback(() => {
    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.999Z`;
    return api<TeamDashboard>(`/dashboard/team?from=${from}&to=${to}${teamQS}`)
      .then(setTeam)
      .catch(() => setTeam(null))
      .finally(() => setLoaded(true));
  }, [date, teamQS]);

  const loadFlags = useCallback(
    () =>
      api<Paginated<FlagDTO>>('/flags')
        .then((p) => {
          setFlags(p.items);
          setFlagsCursor(p.nextCursor);
        })
        .catch(() => setFlags([])),
    [],
  );
  const loadMoreFlags = useCallback(async () => {
    if (!flagsCursor) return;
    const p = await api<Paginated<FlagDTO>>(`/flags?cursor=${flagsCursor}`).catch(() => null);
    if (!p) return;
    setFlags((prev) => [...prev, ...p.items.filter((f) => !prev.some((x) => x.id === f.id))]);
    setFlagsCursor(p.nextCursor);
  }, [flagsCursor]);
  const loadQuestions = useCallback(
    () => api<QuestionDTO[]>('/questions').then(setQuestions).catch(() => setQuestions([])),
    [],
  );
  const loadManagedTasks = useCallback(
    () =>
      api<Paginated<ManagedTaskDTO>>(`/tasks/managed${teamFilter ? `?team=${teamFilter}` : ''}`)
        .then((p) => {
          setManagedTasks(p.items);
          setManagedCursor(p.nextCursor);
        })
        .catch(() => setManagedTasks([])),
    [teamFilter],
  );
  const loadMoreManaged = useCallback(async () => {
    if (!managedCursor) return;
    const qs = new URLSearchParams();
    if (teamFilter) qs.set('team', teamFilter);
    qs.set('cursor', managedCursor);
    const p = await api<Paginated<ManagedTaskDTO>>(`/tasks/managed?${qs.toString()}`).catch(() => null);
    if (!p) return;
    setManagedTasks((prev) => [...(prev ?? []), ...p.items.filter((t) => !(prev ?? []).some((x) => x.id === t.id))]);
    setManagedCursor(p.nextCursor);
  }, [managedCursor, teamFilter]);

  const loadPulse = useCallback(
    () =>
      api<PulseInsights>(`/dashboard/checkins${teamFilter ? `?team=${teamFilter}` : ''}`)
        .then(setPulse)
        .catch(() => setPulse(null)),
    [teamFilter],
  );
  const loadMeetings = useCallback(
    () => api<Paginated<MeetingDTO>>('/meetings').then((p) => setMeetings(p.items)).catch(() => setMeetings([])),
    [],
  );
  const onCreateMeeting = useCallback(
    async (body: CreateMeetingBody) => {
      await api('/meetings', { method: 'POST', body: JSON.stringify(body) });
      toast('Meeting scheduled', 'success');
      await loadMeetings();
    },
    [loadMeetings],
  );
  const onCancelMeeting = useCallback(
    async (id: string) => {
      await api(`/meetings/${id}`, { method: 'DELETE' })
        .then(() => toast('Meeting canceled', 'success'))
        .catch(() => toast('Couldn’t cancel the meeting', 'error'));
      await loadMeetings();
    },
    [loadMeetings],
  );

  const loadDay = useCallback(
    (userId: string) =>
      api<DayTimelineDTO>(`/dashboard/user/${userId}/day?date=${date}`).then(setDay).catch(() => setDay(null)),
    [date],
  );
  const loadTeamDay = useCallback(
    () => api<TeamDayDTO>(`/dashboard/team/day?date=${date}${teamQS}`).then(setTeamDay).catch(() => setTeamDay(null)),
    [date, teamQS],
  );
  const loadTrends = useCallback(
    (userId: string) =>
      api<TrendsDTO>(`/dashboard/user/${userId}/trends`).then(setTrends).catch(() => setTrends(null)),
    [],
  );
  const loadProgress = useCallback(
    (userId: string) =>
      api<ProgressDTO>(`/dashboard/user/${userId}/progress`).then(setProgress).catch(() => setProgress(null)),
    [],
  );

  useEffect(() => {
    if (isOwner) void api<TeamDTOAlias[]>('/teams').then(setTeamsList).catch(() => {});
  }, [isOwner]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);
  usePoll(loadTeam, 30000, isToday);

  const teamDayActive = !selectedUser && tab === 'team' && teamView === 'day';
  useEffect(() => {
    if (!teamDayActive) return;
    void loadTeamDay();
  }, [teamDayActive, loadTeamDay]);
  usePoll(loadTeamDay, 30000, teamDayActive && isToday);

  useEffect(() => {
    if (tab === 'flags') void loadFlags();
    if (tab === 'questions') void loadQuestions();
    if (tab === 'pulse') void loadPulse();
    if (tab === 'meetings') {
      void loadMeetings();
      void api<MemberLiteDTO[]>(`/users${teamFilter ? `?team=${teamFilter}` : ''}`).then(setRoster).catch(() => {});
    }
    if (tab === 'tasks') {
      void loadManagedTasks();
      void api<MemberLiteDTO[]>(`/users${teamFilter ? `?team=${teamFilter}` : ''}`).then(setRoster).catch(() => {});
      if (repos.length === 0) void api<RepoLiteDTO[]>('/repos').then(setRepos).catch(() => {});
    }
  }, [tab, loadFlags, loadQuestions, loadPulse, loadMeetings, loadManagedTasks, teamFilter, repos.length]);

  useEffect(() => {
    if (!selectedUser) return;
    if (personView === 'trends') void loadTrends(selectedUser);
    else if (personView === 'progress') void loadProgress(selectedUser);
    else void loadDay(selectedUser);
  }, [selectedUser, personView, date, loadDay, loadTrends, loadProgress]);

  const selectUser = useCallback(
    (userId: string) => navigate(`/admin/u/${userId}/day${date !== todayStr() ? `?date=${date}` : ''}`),
    [navigate, date],
  );
  // Jump to a person's day timeline, on the day of the given item when provided.
  const openUserDay = useCallback(
    (userId: string, iso?: string | null) => {
      let d = '';
      if (iso) {
        const ds = new Date(iso).toLocaleDateString('en-CA'); // YYYY-MM-DD, local
        if (ds !== todayStr()) d = ds;
      }
      navigate(`/admin/u/${userId}/day${d ? `?date=${d}` : ''}`);
    },
    [navigate],
  );

  const onResolve = useCallback(
    (id: string) => {
      void api(`/flags/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) }).then(loadFlags);
    },
    [loadFlags],
  );
  const onDismiss = useCallback(
    (id: string) => {
      void api(`/flags/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }).then(loadFlags);
    },
    [loadFlags],
  );
  // Stop the running session an idle/long-open flag points at, then resolve the
  // flag. A live meeting can't be force-stopped (its runner must file minutes).
  const onStopSession = useCallback(
    async (flag: FlagDTO) => {
      if (!flag.sessionId) return;
      const who = flag.userLogin ? `@${flag.userLogin}` : 'this dev';
      if (
        !(await confirmDialog({
          title: 'Stop this session?',
          body: `${who}’s timer will end now. This is cleanup for an idle session — it doesn’t delete tracked time.`,
          confirmLabel: 'Stop session',
          danger: true,
        }))
      )
        return;
      try {
        await api<SessionDTO>(`/sessions/${flag.sessionId}/stop`, { method: 'POST', body: '{}' });
        await api(`/flags/${flag.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
        toast('Session stopped', 'success');
      } catch (e) {
        if (isMeetingGate(e)) {
          toast('That’s a meeting — only its runner can end it (minutes required)', 'info');
        } else if (e instanceof ApiError && e.status === 404) {
          // Already stopped elsewhere — the flag is stale; clear it.
          await api(`/flags/${flag.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) }).catch(() => {});
          toast('Session was already stopped', 'info');
        } else {
          toast('Couldn’t stop the session', 'error');
        }
      }
      void loadFlags();
    },
    [loadFlags],
  );
  const onAsk = useCallback(
    (flag: FlagDTO, body: string) => {
      // A question needs a task OR a session to hang on (off-task flags have no task).
      if (!body.trim() || (!flag.taskId && !flag.sessionId)) return;
      void api('/questions', {
        method: 'POST',
        body: JSON.stringify({ targetUserId: flag.userId, taskId: flag.taskId ?? null, sessionId: flag.sessionId, body: body.trim() }),
      }).then(() => {
        void loadQuestions();
        void loadFlags();
      });
    },
    [loadFlags, loadQuestions],
  );

  const onAskQuestion = useCallback(
    (args: { targetUserId: string; taskId: string | null; sessionId: string; body: string }) => {
      void api('/questions', { method: 'POST', body: JSON.stringify(args) })
        .then(() => {
          void loadQuestions();
          // refresh the open day so the question shows in the session thread + "?" marker
          if (selectedUser) void loadDay(selectedUser);
        })
        .catch(() => {});
    },
    [loadQuestions, loadDay, selectedUser],
  );

  // Turn a meeting-minutes action item into a trackable team task.
  const onCreateTaskFromItem = useCallback(
    async (itemId: string) => {
      await api(`/meeting-items/${itemId}/task`, { method: 'POST', body: '{}' })
        .then(() => toast('Task created from the minutes', 'success'))
        .catch(() => toast('Couldn’t create the task', 'error'));
      if (selectedUser) await loadDay(selectedUser);
    },
    [selectedUser, loadDay],
  );

  const endOpenSessions = useCallback(async () => {
    if (!day) return;
    const open = day.lanes.flatMap((l) => l.sessions).filter((s) => s.isOpen);
    // Meetings can only be ended by their runner (they must file the minutes),
    // so bulk-stop skips them and tells the admin.
    const meetings = open.filter((s) => s.offTaskLabel === 'meeting');
    const stoppable = open.filter((s) => s.offTaskLabel !== 'meeting');
    await Promise.all(
      stoppable.map((s) => api(`/sessions/${s.id}/stop`, { method: 'POST', body: '{}' }).catch(() => {})),
    );
    if (meetings.length > 0) {
      toast(`${meetings.length} live meeting${meetings.length > 1 ? 's' : ''} left running — only its owner can end it (minutes required)`, 'info');
    }
    if (selectedUser) await loadDay(selectedUser);
    void loadTeam();
  }, [day, selectedUser, loadDay, loadTeam]);

  const openCount = day ? day.lanes.flatMap((l) => l.sessions).filter((s) => s.isOpen).length : 0;

  const backToTeam = () => {
    const qs = new URLSearchParams();
    if (date !== todayStr()) qs.set('date', date);
    if (teamFilter) qs.set('team', teamFilter);
    const q = qs.toString();
    navigate(`/admin/team${q ? `?${q}` : ''}`);
  };

  const tabBtn = (t: AdminTab, label: string) => (
    <button
      data-tour={`tab-${t}`}
      onClick={() => navigate(`/admin/${t}`)}
      className={`btn btn-sm ${
        tab === t
          ? 'border-hair2 text-text bg-surface2/80'
          : 'border-transparent text-text3 hover:text-text2 hover:bg-surface2/50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Shell>
      <header className="sticky top-0 z-20 border-b border-hair bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70 px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Logo size={22} />
          <span className="text-text3 font-mono text-xs truncate">
            {me.role === 'lead' ? 'lead' : 'admin'}
            {me.teamKey ? ` · ${me.teamKey}` : ''} · {me.githubLogin}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <GuideButton />
          <NotificationToggle />
          <InstallButton />
          <button onClick={signOut} className="btn btn-sm btn-ghost">
            sign out
          </button>
        </div>
      </header>

      <div className="px-4 sm:px-6 pt-5 max-w-6xl mx-auto w-full flex items-center gap-1.5 flex-wrap">
        {tabBtn('team', 'People')}
        {tabBtn('tasks', 'Tasks')}
        {tabBtn('meetings', 'Meetings')}
        {tabBtn('pulse', 'Pulse')}
        {tabBtn('flags', 'Flags')}
        {tabBtn('questions', 'Questions')}
        {isOwner && teamsList.length > 0 && (
          <select
            data-tour="teamfilter"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="field h-8 px-2.5 text-xs font-mono ml-auto [color-scheme:dark]"
            title="filter by team"
          >
            <option value="">all teams</option>
            {teamsList.map((t) => (
              <option key={t.id} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="px-4 sm:px-6 py-5 sm:py-6 max-w-6xl mx-auto">
        {tab === 'flags' ? (
          <FlagsPanel flags={flags} onResolve={onResolve} onDismiss={onDismiss} onAsk={onAsk} onStopSession={onStopSession} onOpenUser={openUserDay} hasMore={flagsCursor != null} onLoadMore={loadMoreFlags} />
        ) : tab === 'questions' ? (
          <QuestionsPanel questions={questions} onOpenUser={openUserDay} />
        ) : tab === 'pulse' ? (
          <PulsePanel data={pulse} />
        ) : tab === 'meetings' ? (
          <MeetingsPanel meetings={meetings} roster={roster} onCreate={onCreateMeeting} onCancel={onCancelMeeting} />
        ) : tab === 'tasks' ? (
          <TasksPanel
            tasks={managedTasks}
            roster={roster}
            repos={repos}
            onChanged={loadManagedTasks}
            hasMore={managedCursor != null}
            onLoadMore={loadMoreManaged}
          />
        ) : selectedUser ? (
          <div className="animate-fade-in">
            <div className="mb-5 flex items-center gap-2 flex-wrap">
              <button onClick={backToTeam} className="btn btn-sm btn-ghost">
                ← team
              </button>
              <div className="inline-flex rounded-lg border border-hair overflow-hidden">
                <button
                  onClick={() => navigate(`/admin/u/${selectedUser}/day`)}
                  className={`font-mono text-xs px-3.5 h-8 transition-colors ${personView === 'day' ? 'bg-surface2/80 text-text' : 'text-text3 hover:text-text2'}`}
                >
                  day
                </button>
                <button
                  onClick={() => navigate(`/admin/u/${selectedUser}/progress`)}
                  className={`font-mono text-xs px-3.5 h-8 border-l border-hair transition-colors ${personView === 'progress' ? 'bg-surface2/80 text-text' : 'text-text3 hover:text-text2'}`}
                >
                  progress
                </button>
                <button
                  onClick={() => navigate(`/admin/u/${selectedUser}/trends`)}
                  className={`font-mono text-xs px-3.5 h-8 border-l border-hair transition-colors ${personView === 'trends' ? 'bg-surface2/80 text-text' : 'text-text3 hover:text-text2'}`}
                >
                  trends
                </button>
              </div>
              {personView === 'day' && <DateNav date={date} setDate={setDate} />}
              <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 flex-wrap sm:justify-end min-w-0">
                {personView === 'day' && openCount > 0 && (
                  <button
                    onClick={endOpenSessions}
                    className="btn btn-sm border-danger/40 text-danger hover:bg-danger/10"
                    title="stop all of this person's open sessions"
                  >
                    ■ end {openCount} open
                  </button>
                )}
                <AskAboutTask
                  targetUserId={selectedUser}
                  onSent={() => {
                    void loadQuestions();
                    if (personView === 'day') void loadDay(selectedUser);
                  }}
                />
              </div>
            </div>
            {personView === 'day' ? (
              day ? (
                <DayTimeline data={day} onAskQuestion={onAskQuestion} onCreateTaskFromItem={onCreateTaskFromItem} />
              ) : (
                <Loading>loading day…</Loading>
              )
            ) : personView === 'progress' ? (
              progress ? (
                <div className="flex flex-col gap-5">
                  <ProgressView data={progress} />
                  <CompletionLog userId={selectedUser} />
                </div>
              ) : (
                <Loading>loading progress…</Loading>
              )
            ) : trends ? (
              <Trends data={trends} />
            ) : (
              <Loading>loading trends…</Loading>
            )}
          </div>
        ) : (
          <div className="animate-fade-in">
            <div className="mb-5 flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg border border-hair overflow-hidden">
                <button
                  onClick={() => navigate(`/admin/team${date === todayStr() ? '' : `?date=${date}`}`)}
                  className={`font-mono text-xs px-3.5 h-8 transition-colors ${teamView === 'roster' ? 'bg-surface2/80 text-text' : 'text-text3 hover:text-text2'}`}
                >
                  roster
                </button>
                <button
                  onClick={() => navigate(`/admin/team/day${date === todayStr() ? '' : `?date=${date}`}`)}
                  className={`font-mono text-xs px-3.5 h-8 border-l border-hair transition-colors ${teamView === 'day' ? 'bg-surface2/80 text-text' : 'text-text3 hover:text-text2'}`}
                >
                  day
                </button>
              </div>
              <DateNav date={date} setDate={setDate} />
              <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 flex-wrap sm:justify-end min-w-0">
                {isOwner && <RunLoginCheckButton />}
                {isOwner && <SendDigestButton />}
                {team && team.members.length > 0 && (
                  <button onClick={() => downloadTeamCsv(team)} className="btn btn-sm btn-ghost">
                    ↓ CSV
                  </button>
                )}
              </div>
            </div>
            {teamView === 'day' ? (
              teamDay ? (
                <TeamDay data={teamDay} onSelectUser={selectUser} />
              ) : (
                <ListSkeleton rows={5} />
              )
            ) : !loaded ? (
              <ListSkeleton rows={5} />
            ) : team ? (
              <TeamOverview data={team} onSelectUser={selectUser} />
            ) : (
              <EmptyState>No team data yet.</EmptyState>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

function Loading({ children }: { children: React.ReactNode }) {
  return (
    <div className="card px-6 py-12 flex items-center justify-center gap-2 animate-fade-in">
      <span className="w-1.5 h-1.5 rounded-full bg-brass/70 animate-pulse" aria-hidden />
      <span className="font-mono text-text3 text-sm">{children}</span>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="card px-6 py-12 text-center font-mono text-sm text-text3 animate-fade-in">
      {children}
    </div>
  );
}

function DateNav({ date, setDate }: { date: string; setDate: React.Dispatch<React.SetStateAction<string>> }) {
  const isToday = date === todayStr();
  // ←/→ step through days — a natural reflex on a timeline view. Ignored while
  // typing in any field so it never fights text editing.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') setDate((d) => shiftDate(d, -1));
      if (e.key === 'ArrowRight' && date !== todayStr()) setDate((d) => shiftDate(d, 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setDate, date]);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => setDate((d) => shiftDate(d, -1))}
        className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-hair hover:border-hair2 hover:bg-surface2/60 text-text2 transition-colors"
        aria-label="previous day"
      >
        ‹
      </button>
      <input
        type="date"
        value={date}
        max={todayStr()}
        onChange={(e) => setDate(e.target.value || todayStr())}
        className="field font-mono text-xs px-2.5 h-8 [color-scheme:dark]"
      />
      <button
        onClick={() => setDate((d) => shiftDate(d, 1))}
        disabled={isToday}
        className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-hair hover:border-hair2 hover:bg-surface2/60 text-text2 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        aria-label="next day"
      >
        ›
      </button>
      {!isToday && (
        <button
          onClick={() => setDate(todayStr())}
          className="btn btn-sm btn-ghost"
        >
          today
        </button>
      )}
      <span className="ml-1 inline-flex items-center gap-1.5 font-mono text-[11px] text-text3">
        <span className={`w-1.5 h-1.5 rounded-full ${isToday ? 'bg-success animate-pulse' : 'bg-text3'}`} aria-hidden />
        {isToday ? 'live' : 'historical'}
      </span>
    </div>
  );
}
