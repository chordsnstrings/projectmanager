import { useCallback, useEffect, useState } from 'react';
import type {
  ActivityType,
  DayTimeline as DayTimelineDTO,
  DraftSummary,
  Me,
  NudgeDTO,
  Paginated,
  SessionDTO,
  TaskDTO,
  TeamDashboard,
} from '@cadence/shared';
import { api, ApiError } from './lib/api';
import { relativeTime } from './lib/format';
import { Logo } from './components/Logo';
import ProgrammerScreen, { type TaskSessionState } from './programmer/ProgrammerScreen';
import TeamOverview from './admin/TeamOverview';
import DayTimeline from './admin/DayTimeline';

type AuthState = { kind: 'loading' } | { kind: 'anon' } | { kind: 'authed'; me: Me };

async function signOut() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/';
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });

  useEffect(() => {
    api<Me>('/me')
      .then((me) => setAuth({ kind: 'authed', me }))
      .catch(() => setAuth({ kind: 'anon' }));
  }, []);

  if (auth.kind === 'loading') return <Splash>connecting…</Splash>;
  if (auth.kind === 'anon') return <SignIn />;
  return auth.me.role === 'admin' ? <AdminApp me={auth.me} /> : <DevApp me={auth.me} />;
}

// ── Chrome ──────────────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-full bg-bg text-text font-sans">{children}</div>;
}
function Splash({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <div className="h-screen grid place-items-center gap-4 text-center">
        <div>
          <div className="mb-3 flex justify-center">
            <Logo size={26} />
          </div>
          <div className="font-mono text-text3 text-sm">{children}</div>
        </div>
      </div>
    </Shell>
  );
}

function SignIn() {
  return (
    <Shell>
      <div className="min-h-screen grid place-items-center p-6">
        <div className="rounded-xl border border-hair bg-panel p-8 text-center max-w-sm w-full">
          <div className="mb-4 flex justify-center">
            <Logo size={30} />
          </div>
          <p className="text-text2 text-sm mb-6">
            Sessions are the clock. Git is the truth. Sign in to see your work.
          </p>
          <a
            href="/auth/github"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-hair2 bg-surface px-4 h-11 text-sm font-medium hover:bg-surface2 w-full"
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
  const [wrapping, setWrapping] = useState<Record<string, { session: SessionDTO; draft: DraftSummary }>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [t, a, n] = await Promise.all([
      api<Paginated<TaskDTO>>('/tasks').then((p) => p.items).catch(() => [] as TaskDTO[]),
      api<SessionDTO[]>('/sessions/active').catch(() => [] as SessionDTO[]),
      api<NudgeDTO[]>('/nudges').catch(() => [] as NudgeDTO[]),
    ]);
    setTasks(t);
    setActive(a);
    setNudges(n);
    setLoaded(true);
  }, []);

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
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [doSync, refresh]);

  const onStart = useCallback(
    async (taskId: string) => {
      await api<SessionDTO>('/sessions', { method: 'POST', body: JSON.stringify({ taskId }) });
      await refresh();
    },
    [refresh],
  );

  const onStop = useCallback(
    async (sessionId: string) => {
      const session = active.find((s) => s.id === sessionId);
      try {
        const draft = await api<DraftSummary>(`/sessions/${sessionId}/draft-summary`);
        if (session) setWrapping((w) => ({ ...w, [session.taskId ?? sessionId]: { session, draft } }));
      } catch {
        await api<SessionDTO>(`/sessions/${sessionId}/stop`, { method: 'POST', body: '{}' });
        await refresh();
      }
    },
    [active, refresh],
  );

  const onSaveSummary = useCallback(
    async (sessionId: string, payload: { summary: string; blocked: boolean; closesIssues: number[] }) => {
      await api<SessionDTO>(`/sessions/${sessionId}/stop`, {
        method: 'POST',
        body: JSON.stringify({ summary: payload.summary, blocked: payload.blocked }),
      });
      setWrapping((w) => {
        const next = { ...w };
        for (const k of Object.keys(next)) if (next[k]!.session.id === sessionId) delete next[k];
        return next;
      });
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

  const onStartOffTask = useCallback(async () => {
    await api<SessionDTO>('/sessions', { method: 'POST', body: JSON.stringify({ offTaskLabel: 'off-task' }) });
    await refresh();
  }, [refresh]);

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
  for (const [taskId, w] of Object.entries(wrapping)) {
    sessionsByTask[taskId] = { state: 'wrapping', session: w.session, draft: w.draft };
  }

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
        onSaveSummary={onSaveSummary}
        onOverrideActivity={onOverrideActivity}
        onStartOffTask={onStartOffTask}
        onStartNudge={onStartNudge}
        onDismissNudge={(n) => setDismissed((d) => new Set(d).add(n.id))}
        onRefresh={doSync}
        onRename={onRename}
        onSignOut={signOut}
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

function AdminApp({ me }: { me: Me }) {
  const [date, setDate] = useState(todayStr);
  const [team, setTeam] = useState<TeamDashboard | null>(null);
  const [day, setDay] = useState<DayTimelineDTO | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const isToday = date === todayStr();

  const loadTeam = useCallback(() => {
    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.999Z`;
    return api<TeamDashboard>(`/dashboard/team?from=${from}&to=${to}`)
      .then(setTeam)
      .catch(() => setTeam(null))
      .finally(() => setLoaded(true));
  }, [date]);

  const loadDay = useCallback(
    (userId: string) => {
      api<DayTimelineDTO>(`/dashboard/user/${userId}/day?date=${date}`)
        .then(setDay)
        .catch(() => setDay(null));
    },
    [date],
  );

  useEffect(() => {
    void loadTeam();
    // live-refresh only matters for the current day
    if (!isToday) return;
    const id = setInterval(loadTeam, 30000);
    return () => clearInterval(id);
  }, [loadTeam, isToday]);

  // refetch the open person's day when the date changes
  useEffect(() => {
    if (selectedUser) loadDay(selectedUser);
  }, [date, selectedUser, loadDay]);

  const selectUser = useCallback(
    (userId: string) => {
      setSelectedUser(userId);
      loadDay(userId);
    },
    [loadDay],
  );

  return (
    <Shell>
      <div className="border-b border-hair px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Logo size={22} />
          <span className="text-text3 font-mono text-xs">admin · {me.githubLogin}</span>
        </div>
        <div className="flex items-center gap-3">
          {day && (
            <button
              onClick={() => {
                setDay(null);
                setSelectedUser(null);
              }}
              className="font-mono text-xs text-text2 hover:text-text"
            >
              ← team
            </button>
          )}
          <button
            onClick={signOut}
            className="font-mono text-xs text-text3 hover:text-text px-2.5 h-8 rounded border border-hair hover:border-hair2"
          >
            sign out
          </button>
        </div>
      </div>

      {/* Date navigation — view any past day (and ranges via the API) */}
      <div className="px-4 sm:px-6 pt-4 max-w-6xl mx-auto w-full flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setDate((d) => shiftDate(d, -1))}
          className="w-8 h-8 inline-flex items-center justify-center rounded border border-hair hover:border-hair2 text-text2"
          aria-label="previous day"
        >
          ‹
        </button>
        <input
          type="date"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value || todayStr())}
          className="font-mono text-xs bg-surface border border-hair rounded px-2 h-8 text-text [color-scheme:dark]"
        />
        <button
          onClick={() => setDate((d) => shiftDate(d, 1))}
          disabled={isToday}
          className="w-8 h-8 inline-flex items-center justify-center rounded border border-hair hover:border-hair2 text-text2 disabled:opacity-40"
          aria-label="next day"
        >
          ›
        </button>
        {!isToday && (
          <button
            onClick={() => setDate(todayStr())}
            className="font-mono text-xs px-2.5 h-8 rounded border border-hair hover:border-hair2 text-text2"
          >
            today
          </button>
        )}
        <span className="font-mono text-[11px] text-text3 ml-auto">
          {isToday ? 'live' : 'historical'}
        </span>
      </div>

      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        {day ? (
          <DayTimeline data={day} />
        ) : !loaded ? (
          <div className="font-mono text-text3 text-sm">loading team…</div>
        ) : team ? (
          <TeamOverview data={team} onSelectUser={selectUser} />
        ) : (
          <div className="font-mono text-text3 text-sm">No team data yet.</div>
        )}
      </div>
    </Shell>
  );
}
