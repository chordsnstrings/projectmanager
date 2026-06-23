import type {
  ActivitySegmentDTO,
  ActivityType,
  CommitDTO,
  DayTimeline,
  FlagDTO,
  TeamDashboard,
  TimelineLane,
} from '@cadence/shared';

// Anchor the fixture day to "today" so live/running bars land sensibly.
const base = new Date();
base.setHours(9, 0, 0, 0);
const dayStartMs = base.getTime();
const H = 3_600_000;
const M = 60_000;

const at = (msFromStart: number) => new Date(dayStartMs + msFromStart).toISOString();

const seg = (
  type: ActivityType,
  startMs: number,
  endMs: number,
  source: ActivitySegmentDTO['source'] = 'inferred',
): ActivitySegmentDTO => ({
  type,
  source,
  startedAt: at(startMs),
  endedAt: at(endMs),
});

const commit = (sha: string, message: string, atMs: number): CommitDTO => ({
  sha,
  message,
  additions: 40 + (sha.charCodeAt(0) % 60),
  deletions: 5 + (sha.charCodeAt(1) % 20),
  filesChanged: 1 + (sha.charCodeAt(2) % 4),
  occurredAt: at(atMs),
});

// ── Day timeline for one programmer, with concurrency + a flag ──────────────

const laneRateLimit: TimelineLane = {
  taskId: 't-issue-142',
  title: 'Add per-tenant rate limiting',
  origin: '#142',
  repoFullName: 'acme/api',
  estimateMinutes: 180,
  actualMinutes: 150,
  varianceMinutes: -30,
  status: 'in_progress',
  sessionCount: 2,
  reopenCount: 0,
  sessions: [
    {
      id: 's-rl-1',
      startedAt: at(0),
      endedAt: at(1 * H + 20 * M),
      isOpen: false,
      intent: 'token-bucket middleware',
      summary: 'Implemented the per-tenant token bucket and wired config.',
      segments: [
        seg('research', 0, 25 * M),
        seg('coding', 25 * M, 1 * H + 20 * M),
      ],
      commits: [
        commit('a1b2c3d', 'feat: token bucket skeleton', 40 * M),
        commit('b2c3d4e', 'feat: per-tenant config wiring', 1 * H + 10 * M),
      ],
      flagIds: [],
      offTaskLabel: null,
      questionIds: [],
    },
    {
      id: 's-rl-2',
      startedAt: at(3 * H),
      endedAt: at(3 * H + 50 * M),
      isOpen: false,
      intent: 'integration tests',
      summary: 'Added integration coverage for burst traffic.',
      segments: [seg('coding', 3 * H, 3 * H + 30 * M), seg('debugging', 3 * H + 30 * M, 3 * H + 50 * M)],
      commits: [commit('c3d4e5f', 'test: burst traffic integration', 3 * H + 45 * M)],
      flagIds: ['f-1'],
      offTaskLabel: null,
      questionIds: [],
    },
  ],
};

const laneOauth: TimelineLane = {
  taskId: 't-pr-88',
  title: 'Fix OAuth redirect loop',
  origin: 'PR #88',
  repoFullName: 'acme/web',
  estimateMinutes: 60,
  actualMinutes: 95,
  varianceMinutes: 35,
  status: 'in_review',
  sessionCount: 1,
  reopenCount: 1,
  sessions: [
    {
      // overlaps laneRateLimit s-rl-1 (concurrent band around 50m–80m)
      id: 's-oauth-1',
      startedAt: at(50 * M),
      endedAt: at(2 * H + 5 * M),
      isOpen: false,
      intent: 'reproduce + fix redirect loop',
      summary: 'Guarded redirect against missing return_to; added slow-path test.',
      segments: [
        seg('debugging', 50 * M, 1 * H + 30 * M),
        seg('coding', 1 * H + 30 * M, 2 * H + 5 * M, 'manual'),
      ],
      commits: [
        commit('d4e5f60', 'fix: guard redirect', 1 * H + 25 * M),
        commit('e5f6071', 'test: slow oauth path', 1 * H + 55 * M),
      ],
      flagIds: [],
      offTaskLabel: null,
      questionIds: [],
    },
  ],
};

const laneSpike: TimelineLane = {
  taskId: 't-branch-foo',
  title: 'Spike: terraform cache tier',
  origin: 'feat/foo',
  repoFullName: 'acme/infra',
  estimateMinutes: null,
  actualMinutes: 35,
  varianceMinutes: null,
  status: 'in_progress',
  sessionCount: 1,
  reopenCount: 0,
  sessions: [
    {
      id: 's-spike-1',
      startedAt: at(4 * H + 10 * M),
      endedAt: null,
      isOpen: true,
      intent: 'reading provider docs',
      summary: null,
      segments: [seg('research', 4 * H + 10 * M, 4 * H + 45 * M)],
      commits: [],
      flagIds: [],
      offTaskLabel: null,
      questionIds: [],
    },
  ],
};

const dayFlags: FlagDTO[] = [
  {
    id: 'f-1',
    type: 'overrun',
    userId: 'u-1',
    sessionId: 's-rl-2',
    taskId: 't-issue-142',
    detail: 'Actual time exceeded the estimate after a review re-cut.',
    status: 'open',
    createdAt: at(3 * H + 40 * M),
  },
];

export const dayTimelineFixture: DayTimeline = {
  userId: 'u-1',
  githubLogin: 'octocat',
  date: base.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  timezone: 'UTC',
  dayStart: at(-30 * M),
  dayEnd: at(5 * H + 30 * M),
  activeElapsedMinutes: 230,
  taskHoursMinutes: 280,
  sessionCount: 4,
  flags: dayFlags,
  questions: [],
  lanes: [laneRateLimit, laneOauth, laneSpike],
};

// ── Team dashboard — 3 members ───────────────────────────────────────────────

export const teamDashboardFixture: TeamDashboard = {
  rangeStart: at(-30 * M),
  rangeEnd: at(5 * H + 30 * M),
  members: [
    {
      userId: 'u-1',
      githubLogin: 'octocat',
      name: 'Octa Cat',
      avatarUrl: null,
      activeElapsedMinutes: 230,
      taskHoursMinutes: 280,
      sessionCount: 4,
      openFlagCount: 1,
      runningTaskTitles: ['Spike: terraform cache tier'],
      lastActiveAt: at(4 * H + 45 * M),
      tasksClosed: 1,
      estimateAccuracy: 1.3,
    },
    {
      userId: 'u-2',
      githubLogin: 'hubot',
      name: 'Hu Bot',
      avatarUrl: null,
      activeElapsedMinutes: 175,
      taskHoursMinutes: 175,
      sessionCount: 2,
      openFlagCount: 0,
      runningTaskTitles: [],
      lastActiveAt: at(2 * H + 10 * M),
      tasksClosed: 3,
      estimateAccuracy: 0.9,
    },
    {
      userId: 'u-3',
      githubLogin: 'monalisa',
      name: null,
      avatarUrl: null,
      activeElapsedMinutes: 310,
      taskHoursMinutes: 360,
      sessionCount: 5,
      openFlagCount: 2,
      runningTaskTitles: ['Migrate billing webhooks', 'Review #903'],
      lastActiveAt: at(5 * H),
      tasksClosed: 0,
      estimateAccuracy: null,
    },
  ],
};
