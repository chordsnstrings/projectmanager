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
  | 'overrun';
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
}

/** Generic paginated envelope — every list endpoint uses this (§2). */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
