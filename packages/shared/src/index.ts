// Shared DTO types used by both server and web (spec §5/§8).
// Enums mirror the Prisma schema as string-literal unions so the web bundle
// never has to import the Prisma client.

export type Role = 'admin' | 'dev';
export type TaskSource = 'issue' | 'pr' | 'branch';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type ActivityType = 'coding' | 'debugging' | 'research' | 'agent' | 'review';
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

/** Activity → colour map (design tokens §9). */
export const ACTIVITY_COLORS: Record<ActivityType, string> = {
  coding: '#2bb68c',
  debugging: '#f0a93b',
  research: '#4c9aea',
  agent: '#9a8cf0',
  review: '#8a909b',
};

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
}

/** Generic paginated envelope — every list endpoint uses this (§2). */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// ── Tasks (§8 GET /tasks) ───────────────────────────────────────────────────
export interface TaskDTO {
  id: string;
  repoFullName: string;
  source: TaskSource;
  githubNumber: number | null;
  branch: string | null;
  title: string;
  status: TaskStatus;
  estimateMinutes: number | null;
  /** sum of this task's sessions, in minutes (computed) */
  actualMinutes: number;
  reopenCount: number;
  /** origin label for the row, e.g. "#142", "PR #88", "feat/foo" */
  origin: string;
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
  sessionId: string | null;
  taskId: string | null;
  detail: string;
  status: FlagStatus;
  createdAt: string;
}

// ── Questions (§8) ──────────────────────────────────────────────────────────
export interface QuestionDTO {
  id: string;
  adminUserId: string;
  targetUserId: string;
  taskId: string;
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
