// Shared DTO types used by both server and web (spec §5/§8).
// Enums mirror the Prisma schema as string-literal unions so the web bundle
// never has to import the Prisma client.

export type Role = 'admin' | 'lead' | 'dev';
export type TaskSource = 'issue' | 'pr' | 'branch' | 'manual';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
/** An activity key. Valid keys are team-specific — see TEAM_ACTIVITIES. */
export type ActivityType = string;
export type ActivitySource = 'inferred' | 'manual';
export type GitEventType =
  | 'commit'
  | 'pr_opened'
  | 'pr_merged'
  | 'pr_closed'
  | 'pr_review'
  | 'push';
export type FlagType =
  | 'open_no_activity'
  | 'activity_no_session'
  | 'long_open_session'
  | 'overrun'
  | 'duplicate_session';
export type FlagStatus = 'open' | 'resolved' | 'dismissed';
export type QuestionStatus = 'open' | 'answered';

// ── Per-team activity taxonomy ───────────────────────────────────────────────
// Each team has its own activity set, colors, and whether git commits are used
// to infer activity. Adding a team later = add an entry here (+ a Team row).
export interface ActivityDef {
  key: string;
  label: string;
  color: string;
}
export interface TeamActivityConfig {
  activities: ActivityDef[];
  inferFromGit: boolean; // run git-commit inference for this team's sessions
  defaultActivity: string;
}
export const TEAM_ACTIVITIES: Record<string, TeamActivityConfig> = {
  programming: {
    inferFromGit: true,
    defaultActivity: 'coding',
    activities: [
      { key: 'coding', label: 'coding', color: '#2bb68c' },
      { key: 'debugging', label: 'debugging', color: '#f0a93b' },
      { key: 'research', label: 'research', color: '#4c9aea' },
      { key: 'agent', label: 'agent', color: '#9a8cf0' },
      { key: 'review', label: 'review', color: '#8a909b' },
    ],
  },
  marketing: {
    inferFromGit: false,
    defaultActivity: 'design',
    activities: [
      { key: 'design', label: 'design', color: '#2bb68c' },
      { key: 'video', label: 'video', color: '#f0a93b' },
      { key: 'copywriting', label: 'copywriting', color: '#e0739a' },
      { key: 'research', label: 'research', color: '#4c9aea' },
      { key: 'ai', label: 'ai', color: '#9a8cf0' },
    ],
  },
};

/** Merged activity-key → colour map across all teams (for rendering segments). */
export const ACTIVITY_COLORS: Record<string, string> = Object.fromEntries(
  Object.values(TEAM_ACTIVITIES).flatMap((c) => c.activities.map((a) => [a.key, a.color])),
);

/** Valid activity keys for a team key (empty if the team is unknown). */
export function activityKeysFor(teamKey: string | null | undefined): string[] {
  return teamKey && TEAM_ACTIVITIES[teamKey] ? TEAM_ACTIVITIES[teamKey].activities.map((a) => a.key) : [];
}

export interface HealthStatus {
  status: 'ok';
  time: string; // ISO timestamp
}

/** GET /me */
export interface Me {
  id: string;
  githubLogin: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: Role;
  stopOnCommit: boolean;
  timezone: string | null;
  teamId: string | null;
  teamKey: string | null; // registry key for the activity set (null until onboarded)
  onboardingComplete: boolean; // = teamId != null
}

/** A team for the onboarding picker / admin switcher. */
export interface TeamDTO {
  id: string;
  key: string;
  name: string;
}

/** Generic paginated envelope — every list endpoint uses this (§2). */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// ── Tasks (§8 GET /tasks) ───────────────────────────────────────────────────
export interface TaskDTO {
  id: string;
  /** null for manual (non-git) tasks */
  repoFullName: string | null;
  source: TaskSource;
  githubNumber: number | null;
  branch: string | null;
  title: string;
  status: TaskStatus;
  estimateMinutes: number | null;
  /** sum of this task's sessions, in minutes (computed) */
  actualMinutes: number;
  reopenCount: number;
  /** primary owner (null if unassigned) */
  assigneeUserId: string | null;
  /** origin label for the row, e.g. "#142", "PR #88", "feat/foo", "task" */
  origin: string;
}

/** Slim user shape for assignee / collaborator pickers and avatars. */
export interface MemberLite {
  id: string;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Slim connected-repo shape for the "create branch" picker. */
export interface RepoLite {
  id: string;
  fullName: string;
  defaultBranch: string;
}

/** A manual/assigned task as shown in the admin Tasks tab. */
export interface ManagedTask extends TaskDTO {
  assignee: MemberLite | null;
  members: MemberLite[];
  createdAt: string;
}

// ── Sessions (§8) ───────────────────────────────────────────────────────────
export interface ActivitySegmentDTO {
  type: ActivityType;
  source: ActivitySource;
  startedAt: string;
  endedAt: string;
}

export interface CommitDTO {
  sha: string;
  message: string;
  additions: number | null;
  deletions: number | null;
  filesChanged: number | null;
  occurredAt: string;
}

export interface SessionDTO {
  id: string;
  userId: string;
  taskId: string | null;
  offTaskLabel: string | null;
  startedAt: string;
  endedAt: string | null;
  isOpen: boolean;
  intent: string | null;
  summary: string | null;
  blocked: boolean;
  segments: ActivitySegmentDTO[];
  /** dominant inferred activity (drives the 3px running-row edge, §9) */
  inferredActivity: ActivityType | null;
}

export interface StartSessionBody {
  taskId?: string;
  offTaskLabel?: string;
  intent?: string;
  /** backfill a completed session for TODAY (e.g. a meeting): both required together */
  startedAt?: string;
  endedAt?: string;
}

/** Common non-git activities a dev can log off-task. */
export const OFF_TASK_LABELS = ['meeting', 'research', 'study', 'review', 'pairing', 'planning'] as const;

export interface StopSessionBody {
  summary?: string;
  blocked?: boolean;
  markTaskDone?: boolean;
}

export interface DraftSummary {
  /** detected line: "1h 12m · 3 commits · coding 80% / debugging 20%" */
  detected: string;
  durationMinutes: number;
  commitCount: number;
  /** fraction of time per activity type */
  activitySplit: { type: ActivityType; fraction: number }[];
  /** editable one-line summary auto-drafted from commits */
  summary: string;
  /** suggested "closes #N" toggles from commit/PR keywords */
  closesIssues: number[];
}

export interface ActivityOverrideBody {
  type: ActivityType;
  startedAt: string;
  endedAt: string;
}

// ── Nudges (§8 GET /nudges) ─────────────────────────────────────────────────
export interface NudgeDTO {
  id: string;
  kind: 'commit_no_session';
  repoFullName: string;
  branch: string | null;
  suggestedTaskId: string | null;
  detail: string;
  occurredAt: string;
}

// ── Flags (§8 GET /flags) ───────────────────────────────────────────────────
export interface FlagDTO {
  id: string;
  type: FlagType;
  userId: string;
  /** who the flag is about (so an all-team view can tell people apart) */
  userLogin: string | null;
  sessionId: string | null;
  taskId: string | null;
  /** which task the flag is about, when applicable */
  taskTitle: string | null;
  taskOrigin: string | null;
  repoFullName: string | null;
  detail: string;
  status: FlagStatus;
  createdAt: string;
}

// ── Questions (§8) ──────────────────────────────────────────────────────────
export interface QuestionDTO {
  id: string;
  adminUserId: string;
  targetUserId: string;
  /** who must answer (so an admin all-team queue can tell people apart) */
  targetLogin: string | null;
  taskId: string;
  /** task context so the recipient knows what the question is about */
  taskTitle: string | null;
  taskOrigin: string | null; // "#142", "PR #88", branch, or "task"
  repoFullName: string | null;
  sessionId: string | null;
  body: string;
  blocksNext: boolean;
  status: QuestionStatus;
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface RaiseQuestionBody {
  targetUserId: string;
  taskId: string;
  sessionId?: string;
  body: string;
  blocksNext?: boolean;
}

export interface AnswerQuestionBody {
  answer: string;
}

// ── Dashboard (§8/§9b) ──────────────────────────────────────────────────────
export interface TeamMemberRollup {
  userId: string;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
  /** union of session intervals, minutes */
  activeElapsedMinutes: number;
  /** sum of sessions, minutes (may exceed elapsed under concurrency) */
  taskHoursMinutes: number;
  sessionCount: number;
  openFlagCount: number;
  runningTaskTitles: string[];
  lastActiveAt: string | null;
  tasksClosed: number;
  /** median actual/estimate ratio, or null if no estimates */
  estimateAccuracy: number | null;
}

export interface TeamDashboard {
  rangeStart: string;
  rangeEnd: string;
  members: TeamMemberRollup[];
}

/** Compact session for the multi-member team day view (shared wall-clock axis). */
export interface TeamDaySession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  isOpen: boolean;
  title: string; // task display title / title, or off-task label
  segments: ActivitySegmentDTO[];
}

export interface TeamDayMember {
  userId: string;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
  activeElapsedMinutes: number;
  sessionCount: number;
  openFlagCount: number;
  runningTitles: string[];
  sessions: TeamDaySession[];
}

// ── Productivity / progress / completion / versions ─────────────────────────
export interface ProductivityWindow {
  activeMinutes: number;
  taskHoursMinutes: number;
  sessions: number;
  completed: number;
}
export interface Productivity {
  timezone: string;
  today: ProductivityWindow;
  week: ProductivityWindow; // last 7 local days incl. today
}

export interface ProgressPoint {
  weekStart: string;
  completed: number;
  activeMinutes: number;
  taskHoursMinutes: number;
}
export interface MilestoneRollup {
  title: string;
  dueOn: string | null;
  total: number;
  done: number;
  pct: number; // 0..100
}
export interface VersionRollup {
  repoFullName: string;
  version: string;
  at: string | null;
}
export interface Progress {
  userId: string;
  githubLogin: string;
  totalCompleted: number;
  openCount: number;
  inReviewCount: number;
  completionRate: number; // done / (done+open), 0..1
  points: ProgressPoint[];
  milestones: MilestoneRollup[];
  versions: VersionRollup[];
}

export interface CompletionItem {
  taskId: string;
  title: string;
  repoFullName: string;
  origin: string;
  status: TaskStatus;
  milestoneTitle: string | null;
  estimateMinutes: number | null;
  actualMinutes: number;
  closedAt: string | null;
}

/** One day across the whole team — one row per member on a shared time axis. */
export interface TeamDay {
  date: string; // YYYY-MM-DD (the admin's local day)
  timezone: string; // IANA tz the axis is expressed in (the admin's)
  dayStart: string;
  dayEnd: string;
  members: TeamDayMember[];
}

/** One task lane in the per-person day timeline (§9b). */
export interface TimelineLane {
  taskId: string | null;
  title: string;
  origin: string;
  repoFullName: string;
  estimateMinutes: number | null;
  actualMinutes: number;
  varianceMinutes: number | null;
  status: TaskStatus;
  sessionCount: number;
  reopenCount: number;
  sessions: TimelineSession[];
}

export interface TimelineSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  isOpen: boolean;
  intent: string | null;
  summary: string | null;
  offTaskLabel: string | null;
  segments: ActivitySegmentDTO[];
  commits: CommitDTO[];
  flagIds: string[];
  questionIds: string[];
}

export interface DayTimeline {
  userId: string;
  githubLogin: string;
  date: string; // YYYY-MM-DD (the user's local calendar day)
  timezone: string; // IANA tz the day boundaries + times are expressed in
  dayStart: string;
  dayEnd: string;
  activeElapsedMinutes: number;
  taskHoursMinutes: number;
  sessionCount: number;
  flags: FlagDTO[];
  questions: QuestionDTO[];
  lanes: TimelineLane[];
}

export interface TrendPoint {
  weekStart: string;
  estimateAccuracy: number | null;
  reworkRate: number | null;
  flagCount: number;
  cycleTimeMinutes: number | null;
  touchTimeMinutes: number | null;
  activityMix: Partial<Record<ActivityType, number>>;
}

export interface Trends {
  userId: string;
  points: TrendPoint[];
}
