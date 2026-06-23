import type {
  CommitDTO,
  DraftSummary,
  NudgeDTO,
  SessionDTO,
  TaskDTO,
} from '@cadence/shared';
import type { ProgrammerScreenProps, TaskSessionState } from './ProgrammerScreen';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const MIN = 60_000;

const tasks: TaskDTO[] = [
  {
    id: 't-issue-142',
    repoFullName: 'acme/api',
    source: 'issue',
    githubNumber: 142,
    branch: 'feat/rate-limit',
    title: 'Add per-tenant rate limiting to the gateway',
    status: 'in_progress',
    estimateMinutes: 180,
    actualMinutes: 96,
    reopenCount: 0,
    origin: '#142',
  },
  {
    id: 't-pr-88',
    repoFullName: 'acme/web',
    source: 'pr',
    githubNumber: 88,
    branch: 'fix/login-redirect',
    title: 'Fix OAuth redirect loop on slow connections',
    status: 'in_review',
    estimateMinutes: 60,
    actualMinutes: 74,
    reopenCount: 1,
    origin: 'PR #88',
  },
  {
    id: 't-branch-foo',
    repoFullName: 'acme/infra',
    source: 'branch',
    githubNumber: null,
    branch: 'feat/foo',
    title: 'Spike: terraform module for the new cache tier',
    status: 'in_progress',
    estimateMinutes: null,
    actualMinutes: 22,
    reopenCount: 0,
    origin: 'feat/foo',
  },
  {
    id: 't-issue-201',
    repoFullName: 'acme/api',
    source: 'issue',
    githubNumber: 201,
    branch: null,
    title: 'Document the webhook retry semantics',
    status: 'todo',
    estimateMinutes: 45,
    actualMinutes: 0,
    reopenCount: 0,
    origin: '#201',
  },
];

const runningSession142: SessionDTO = {
  id: 's-142',
  userId: 'u-1',
  taskId: 't-issue-142',
  offTaskLabel: null,
  startedAt: iso(37 * MIN + 12_000),
  endedAt: null,
  isOpen: true,
  intent: 'wire up the token-bucket middleware',
  summary: null,
  blocked: false,
  segments: [],
  inferredActivity: 'coding',
};

const runningSessionFoo: SessionDTO = {
  id: 's-foo',
  userId: 'u-1',
  taskId: 't-branch-foo',
  offTaskLabel: null,
  startedAt: iso(8 * MIN + 41_000),
  endedAt: null,
  isOpen: true,
  intent: 'reading provider docs',
  summary: null,
  blocked: false,
  segments: [],
  inferredActivity: 'research',
};

const wrapCommits: CommitDTO[] = [
  {
    sha: 'a1b2c3d4e5f6',
    message: 'fix: guard redirect against missing return_to',
    additions: 38,
    deletions: 12,
    filesChanged: 3,
    occurredAt: iso(50 * MIN),
  },
  {
    sha: 'f6e5d4c3b2a1',
    message: 'test: cover slow-connection oauth path',
    additions: 64,
    deletions: 2,
    filesChanged: 1,
    occurredAt: iso(20 * MIN),
  },
];

const wrapSession88: SessionDTO = {
  id: 's-88',
  userId: 'u-1',
  taskId: 't-pr-88',
  offTaskLabel: null,
  startedAt: iso(74 * MIN),
  endedAt: iso(1 * MIN),
  isOpen: false,
  intent: 'reproduce the redirect loop',
  summary: null,
  blocked: false,
  segments: [],
  inferredActivity: 'debugging',
};

const wrapDraft88: DraftSummary = {
  detected: '1h 13m · 2 commits · debugging 60% / coding 40%',
  durationMinutes: 73,
  commitCount: 2,
  activitySplit: [
    { type: 'debugging', fraction: 0.6 },
    { type: 'coding', fraction: 0.4 },
  ],
  summary: 'Guarded the OAuth redirect against a missing return_to and added a slow-path test.',
  closesIssues: [88, 91],
};

const nudge: NudgeDTO = {
  id: 'n-1',
  kind: 'commit_no_session',
  repoFullName: 'acme/api',
  branch: 'feat/rate-limit',
  suggestedTaskId: 't-issue-142',
  detail: '3 commits in the last 20m with no open session',
  occurredAt: iso(4 * MIN),
};

const sessionsByTask: Record<string, TaskSessionState> = {
  't-issue-142': { state: 'running', session: runningSession142 },
  't-pr-88': { state: 'wrapping', session: wrapSession88, draft: wrapDraft88, commits: wrapCommits },
  't-branch-foo': { state: 'running', session: runningSessionFoo },
  't-issue-201': { state: 'idle' },
};

export const programmerFixtures: ProgrammerScreenProps = {
  login: 'octocat',
  syncedAgo: '2m',
  date: 'Tuesday, June 23',
  nudge,
  tasks,
  sessionsByTask,
};
