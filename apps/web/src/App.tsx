import { useCallback, useEffect, useState } from 'react';
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
  Trends as TrendsDTO,
} from '@cadence/shared';
import { api, ApiError } from './lib/api';
import { relativeTime } from './lib/format';
import { downloadTeamCsv } from './lib/csv';
import { Logo } from './components/Logo';
import ProgrammerScreen, { type TaskSessionState } from './programmer/ProgrammerScreen';
import TeamOverview from './admin/TeamOverview';
import DayTimeline from './admin/DayTimeline';
import Trends from './admin/Trends';
import FlagsPanel from './admin/FlagsPanel';
import QuestionsPanel from './admin/QuestionsPanel';

type AuthState = { kind: 'loading' } | { kind: 'anon' } | { kind: 'authed'; me: Me };

async function signOut() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/';
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
    window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
    setLoc(to);
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
      .then((me) => setAuth({ kind: 'authed', me }))
      .catch(() => setAuth({ kind: 'anon' }));
  }, []);

  // Land on the right slug once the role is known.
  useEffect(() => {
    if (auth.kind !== 'authed') return;
    const p = route.path;
    if (auth.me.role === 'dev') {
      if (p !== '/board') route.navigate('/board', true);
    } else if (!p.startsWith('/admin')) {
      route.navigate('/admin/team', true);
    }
  }, [auth, route.path, route.navigate]);

  if (auth.kind === 'loading') return <Splash>connecting…</Splash>;
  if (auth.kind === 'anon') return <SignIn />;
  return auth.me.role === 'admin' ? <AdminApp me={auth.me} route={route} /> : <DevApp me={auth.me} />;
}

// ── Chrome ──────────────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-full text-text font-sans">{children}</div>;
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
function DevApp({ me }: { me: Me }) {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [active, setActive] = useState<SessionDTO[]>([]);
  const [nudges, setNudges] = useState<NudgeDTO[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<QuestionDTO[]>([]);
  const [stopOnCommit, setStopOnCommit] = useState(me.stopOnCommit);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [t, a, n, q] = await Promise.all([
      api<Paginated<TaskDTO>>('/tasks').then((p) => p.items).catch(() => [] as TaskDTO[]),
      api<SessionDTO[]>('/sessions/active').catch(() => [] as SessionDTO[]),
      api<NudgeDTO[]>('/nudges').catch(() => [] as NudgeDTO[]),
      api<QuestionDTO[]>('/questions?status=open').catch(() => [] as QuestionDTO[]),
    ]);
    setTasks(t);
    setActive(a);
    setNudges(n);
    setQuestions(q);
    setLoaded(true);
  }, []);

  const onAnswerQuestion = useCallback(
    async (id: string, answer: string) => {
      await api(`/questions/${id}/answer`, { method: 'POST', body: JSON.stringify({ answer }) }).catch(() => {});
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
    const id = setInterval(refresh, 15000); // near-live for questions
    return () => clearInterval(id);
  }, [doSync, refresh]);

  const onStart = useCallback(
    async (taskId: string) => {
      await api<SessionDTO>('/sessions', { method: 'POST', body: JSON.stringify({ taskId }) });
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
      await api<SessionDTO>(`/sessions/${sessionId}/stop`, {
        method: 'POST',
        body: JSON.stringify(summary ? { summary } : {}),
      }).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  const onEditSummary = useCallback(
    async (sessionId: string, summary: string) => {
      await api(`/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ summary }) }).catch(() => {});
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
      await api<SessionDTO>(`/sessions/${sessionId}/stop`, { method: 'POST', body: '{}' }).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  const onStartOffTask = useCallback(async () => {
    await api<SessionDTO>('/sessions', { method: 'POST', body: JSON.stringify({ offTaskLabel: 'off-task' }) });
    await refresh();
  }, [refresh]);

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
    async (n: NudgeDTO) => {
      if (n.suggestedTaskId) await onStart(n.suggestedTaskId);
      else await onStartOffTask();
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

  if (!loaded) return <Splash>loading your board…</Splash>;

  const sessionsByTask: Record<string, TaskSessionState> = {};
  for (const s of active) if (s.taskId) sessionsByTask[s.taskId] = { state: 'running', session: s };

  const nudge = nudges.find((n) => !dismissed.has(n.id)) ?? null;
  const syncedAgo = lastSync ? relativeTime(new Date(lastSync).toISOString()) : 'never';

  return (
    <Shell>
      <ProgrammerScreen
        login={me.githubLogin}
        syncedAgo={syncedAgo}
        syncing={syncing}
        date={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
        nudge={nudge}
        tasks={tasks}
        sessionsByTask={sessionsByTask}
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
        offTaskRunning={active.filter((s) => !s.taskId && s.isOpen)}
        onStopOffTask={onStopOffTask}
        questions={questions}
        onAnswerQuestion={onAnswerQuestion}
        stopOnCommit={stopOnCommit}
        onToggleStopOnCommit={onToggleStopOnCommit}
      />
    </Shell>
  );
}

// ── Admin ─────────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);
function shiftDate(d: string, delta: number): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

type AdminTab = 'team' | 'flags' | 'questions';

function AdminApp({ me, route }: { me: Me; route: Route }) {
  const { path, params, navigate } = route;
  // Navigation state is derived from the slug.
  const personMatch = path.match(/^\/admin\/u\/([^/]+)\/(day|trends)$/);
  const selectedUser = personMatch ? personMatch[1]! : null;
  const personView: 'day' | 'trends' = personMatch && personMatch[2] === 'trends' ? 'trends' : 'day';
  const tab: AdminTab = path.startsWith('/admin/flags')
    ? 'flags'
    : path.startsWith('/admin/questions')
      ? 'questions'
      : 'team';
  const date = params.get('date') ?? todayStr();
  const isToday = date === todayStr();

  const [team, setTeam] = useState<TeamDashboard | null>(null);
  const [day, setDay] = useState<DayTimelineDTO | null>(null);
  const [trends, setTrends] = useState<TrendsDTO | null>(null);
  const [flags, setFlags] = useState<FlagDTO[]>([]);
  const [questions, setQuestions] = useState<QuestionDTO[]>([]);
  const [loaded, setLoaded] = useState(false);

  // setDate keeps the slug, writing ?date= (dropped when today).
  const setDate: React.Dispatch<React.SetStateAction<string>> = (upd) => {
    const next = typeof upd === 'function' ? (upd as (d: string) => string)(date) : upd;
    navigate(`${path}${next === todayStr() ? '' : `?date=${next}`}`);
  };

  const loadTeam = useCallback(() => {
    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.999Z`;
    return api<TeamDashboard>(`/dashboard/team?from=${from}&to=${to}`)
      .then(setTeam)
      .catch(() => setTeam(null))
      .finally(() => setLoaded(true));
  }, [date]);

  const loadFlags = useCallback(
    () => api<Paginated<FlagDTO>>('/flags').then((p) => setFlags(p.items)).catch(() => setFlags([])),
    [],
  );
  const loadQuestions = useCallback(
    () => api<QuestionDTO[]>('/questions').then(setQuestions).catch(() => setQuestions([])),
    [],
  );

  const loadDay = useCallback(
    (userId: string) =>
      api<DayTimelineDTO>(`/dashboard/user/${userId}/day?date=${date}`).then(setDay).catch(() => setDay(null)),
    [date],
  );
  const loadTrends = useCallback(
    (userId: string) =>
      api<TrendsDTO>(`/dashboard/user/${userId}/trends`).then(setTrends).catch(() => setTrends(null)),
    [],
  );

  useEffect(() => {
    void loadTeam();
    if (!isToday) return;
    const id = setInterval(loadTeam, 30000);
    return () => clearInterval(id);
  }, [loadTeam, isToday]);

  useEffect(() => {
    if (tab === 'flags') void loadFlags();
    if (tab === 'questions') void loadQuestions();
  }, [tab, loadFlags, loadQuestions]);

  useEffect(() => {
    if (!selectedUser) return;
    if (personView === 'trends') void loadTrends(selectedUser);
    else void loadDay(selectedUser);
  }, [selectedUser, personView, date, loadDay, loadTrends]);

  const selectUser = useCallback((userId: string) => navigate(`/admin/u/${userId}/day`), [navigate]);

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
  const onAsk = useCallback(
    (flag: FlagDTO, body: string) => {
      if (!flag.taskId || !body.trim()) return;
      void api('/questions', {
        method: 'POST',
        body: JSON.stringify({ targetUserId: flag.userId, taskId: flag.taskId, sessionId: flag.sessionId, body: body.trim() }),
      }).then(() => {
        void loadQuestions();
        void loadFlags();
      });
    },
    [loadFlags, loadQuestions],
  );

  const onAskQuestion = useCallback(
    (args: { targetUserId: string; taskId: string; sessionId: string; body: string }) => {
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

  const endOpenSessions = useCallback(async () => {
    if (!day) return;
    const open = day.lanes.flatMap((l) => l.sessions).filter((s) => s.isOpen);
    await Promise.all(
      open.map((s) => api(`/sessions/${s.id}/stop`, { method: 'POST', body: '{}' }).catch(() => {})),
    );
    if (selectedUser) await loadDay(selectedUser);
    void loadTeam();
  }, [day, selectedUser, loadDay, loadTeam]);

  const openCount = day ? day.lanes.flatMap((l) => l.sessions).filter((s) => s.isOpen).length : 0;

  const backToTeam = () => navigate('/admin/team');

  const tabBtn = (t: AdminTab, label: string) => (
    <button
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
          <span className="text-text3 font-mono text-xs truncate">admin · {me.githubLogin}</span>
        </div>
        <button onClick={signOut} className="btn btn-sm btn-ghost">
          sign out
        </button>
      </header>

      <div className="px-4 sm:px-6 pt-5 max-w-6xl mx-auto w-full flex items-center gap-1.5 flex-wrap">
        {tabBtn('team', 'Team')}
        {tabBtn('flags', 'Flags')}
        {tabBtn('questions', 'Questions')}
      </div>

      <div className="px-4 sm:px-6 py-5 sm:py-6 max-w-6xl mx-auto">
        {tab === 'flags' ? (
          <FlagsPanel flags={flags} onResolve={onResolve} onDismiss={onDismiss} onAsk={onAsk} />
        ) : tab === 'questions' ? (
          <QuestionsPanel questions={questions} />
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
                  onClick={() => navigate(`/admin/u/${selectedUser}/trends`)}
                  className={`font-mono text-xs px-3.5 h-8 border-l border-hair transition-colors ${personView === 'trends' ? 'bg-surface2/80 text-text' : 'text-text3 hover:text-text2'}`}
                >
                  trends
                </button>
              </div>
              {personView === 'day' && <DateNav date={date} setDate={setDate} />}
              {personView === 'day' && openCount > 0 && (
                <button
                  onClick={endOpenSessions}
                  className="btn btn-sm border-danger/40 text-danger hover:bg-danger/10 ml-auto"
                  title="stop all of this person's open sessions"
                >
                  ■ end {openCount} open
                </button>
              )}
            </div>
            {personView === 'day' ? (
              day ? (
                <DayTimeline data={day} onAskQuestion={onAskQuestion} />
              ) : (
                <Loading>loading day…</Loading>
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
              <DateNav date={date} setDate={setDate} />
              {team && team.members.length > 0 && (
                <button
                  onClick={() => downloadTeamCsv(team)}
                  className="btn btn-sm btn-ghost ml-auto"
                >
                  ↓ CSV
                </button>
              )}
            </div>
            {!loaded ? (
              <Loading>loading team…</Loading>
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
