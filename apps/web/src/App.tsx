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
import ProgrammerScreen, {
  type TaskSessionState,
} from './programmer/ProgrammerScreen';
import TeamOverview from './admin/TeamOverview';
import DayTimeline from './admin/DayTimeline';

type AuthState = { kind: 'loading' } | { kind: 'anon' } | { kind: 'authed'; me: Me };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });

  useEffect(() => {
    api<Me>('/me')
      .then((me) => setAuth({ kind: 'authed', me }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setAuth({ kind: 'anon' });
        else setAuth({ kind: 'anon' });
      });
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
      <div className="h-screen grid place-items-center font-mono text-text2 text-sm">{children}</div>
    </Shell>
  );
}

function SignIn() {
  return (
    <Shell>
      <div className="h-screen grid place-items-center">
        <div className="rounded-xl border border-hair bg-panel p-8 text-center max-w-sm">
          <div className="text-[15px] font-semibold tracking-tight mb-1">cadence</div>
          <p className="text-text2 text-sm mb-6">
            Sessions are the clock. Git is the truth. Sign in to see your work.
          </p>
          <a
            href="/auth/github"
            className="inline-block rounded-lg border border-hair2 bg-surface px-4 py-2 text-sm font-medium hover:bg-surface2"
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

  const refresh = useCallback(async () => {
    const [t, a, n] = await Promise.all([
      api<Paginated<TaskDTO>>('/tasks').then((p) => p.items).catch(() => []),
      api<SessionDTO[]>('/sessions/active').catch(() => []),
      api<NudgeDTO[]>('/nudges').catch(() => []),
    ]);
    setTasks(t);
    setActive(a);
    setNudges(n);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const onStart = useCallback(
    async (taskId: string) => {
      await api<SessionDTO>('/sessions', { method: 'POST', body: JSON.stringify({ taskId }) });
      await refresh();
    },
    [refresh],
  );

  const onStop = useCallback(async (sessionId: string) => {
    // Transition to the wrap-up panel: fetch the auto-drafted summary first.
    const session = active.find((s) => s.id === sessionId);
    try {
      const draft = await api<DraftSummary>(`/sessions/${sessionId}/draft-summary`);
      if (session) setWrapping((w) => ({ ...w, [session.taskId ?? sessionId]: { session, draft } }));
    } catch {
      // no draft (e.g. off-task) — just stop
      await api<SessionDTO>(`/sessions/${sessionId}/stop`, { method: 'POST', body: '{}' });
      await refresh();
    }
  }, [active, refresh]);

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

  // Build per-task state: running (active) / wrapping / idle.
  const sessionsByTask: Record<string, TaskSessionState> = {};
  for (const s of active) {
    if (s.taskId) sessionsByTask[s.taskId] = { state: 'running', session: s };
  }
  for (const [taskId, w] of Object.entries(wrapping)) {
    sessionsByTask[taskId] = { state: 'wrapping', session: w.session, draft: w.draft };
  }

  const nudge = nudges.find((n) => !dismissed.has(n.id)) ?? null;

  return (
    <Shell>
      <ProgrammerScreen
        login={me.githubLogin}
        syncedAgo="just now"
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
      />
    </Shell>
  );
}

// ── Admin ─────────────────────────────────────────────────────────────────────
function AdminApp({ me }: { me: Me }) {
  const [team, setTeam] = useState<TeamDashboard | null>(null);
  const [day, setDay] = useState<DayTimelineDTO | null>(null);

  useEffect(() => {
    const load = () => api<TeamDashboard>('/dashboard/team').then(setTeam).catch(() => setTeam(null));
    void load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const selectUser = useCallback((userId: string) => {
    const date = new Date().toISOString().slice(0, 10);
    api<DayTimelineDTO>(`/dashboard/user/${userId}/day?date=${date}`).then(setDay).catch(() => setDay(null));
  }, []);

  return (
    <Shell>
      <div className="border-b border-hair px-6 py-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-[15px] font-semibold tracking-tight">cadence</span>
          <span className="text-text3 font-mono text-xs">admin · {me.githubLogin}</span>
        </div>
        {day && (
          <button onClick={() => setDay(null)} className="font-mono text-xs text-text2 hover:text-text">
            ← team
          </button>
        )}
      </div>
      <div className="p-6 max-w-6xl mx-auto">
        {day ? (
          <DayTimeline data={day} />
        ) : team ? (
          <TeamOverview data={team} onSelectUser={selectUser} />
        ) : (
          <div className="font-mono text-text2 text-sm">loading team…</div>
        )}
      </div>
    </Shell>
  );
}
