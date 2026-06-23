// Flag computation (§6). Pure predicates over sessions/git-events; never
// auto-blocking. The reconcile job + webhook path persist the candidates.
import type { FlagType } from '@cadence/db';

export interface FlagCandidate {
  type: FlagType;
  userId: string;
  sessionId?: string | null;
  taskId?: string | null;
  gitEventId?: string | null;
  detail: string;
}

export interface SessionView {
  id: string;
  userId: string;
  taskId: string | null;
  startedAt: number; // epoch ms
  endedAt: number | null; // null = open
  /** count of git-events that fall inside this session's window */
  innerGitEvents: number;
}

const MS_MIN = 60000;

/** open_no_activity: session open > IDLE_MINUTES with no git-event inside it. */
export function openNoActivity(
  s: SessionView,
  now: number,
  idleMinutes: number,
): FlagCandidate | null {
  if (s.endedAt !== null) return null;
  const openMin = (now - s.startedAt) / MS_MIN;
  if (openMin > idleMinutes && s.innerGitEvents === 0) {
    return {
      type: 'open_no_activity',
      userId: s.userId,
      sessionId: s.id,
      taskId: s.taskId,
      detail: `Session open ${Math.round(openMin)}m with no git activity (idle > ${idleMinutes}m).`,
    };
  }
  return null;
}

/** long_open_session: session open > MAX_OPEN_HOURS. */
export function longOpenSession(
  s: SessionView,
  now: number,
  maxOpenHours: number,
): FlagCandidate | null {
  if (s.endedAt !== null) return null;
  const openHours = (now - s.startedAt) / (MS_MIN * 60);
  if (openHours > maxOpenHours) {
    return {
      type: 'long_open_session',
      userId: s.userId,
      sessionId: s.id,
      taskId: s.taskId,
      detail: `Session open ${openHours.toFixed(1)}h (> ${maxOpenHours}h). Still on this?`,
    };
  }
  return null;
}

/** overrun: actualMinutes > OVERRUN_FACTOR × estimateMinutes. */
export function overrun(
  task: { id: string; estimateMinutes: number | null; actualMinutes: number; assigneeUserId: string | null },
  factor: number,
): FlagCandidate | null {
  if (!task.estimateMinutes || task.estimateMinutes <= 0 || !task.assigneeUserId) return null;
  if (task.actualMinutes > factor * task.estimateMinutes) {
    const ratio = (task.actualMinutes / task.estimateMinutes).toFixed(1);
    return {
      type: 'overrun',
      userId: task.assigneeUserId,
      taskId: task.id,
      detail: `Actual ${task.actualMinutes}m is ${ratio}× the ${task.estimateMinutes}m estimate (> ${factor}×).`,
    };
  }
  return null;
}

/**
 * duplicate_session: two or more sessions on the SAME task/off-task overlap in
 * time for one user — i.e. duplicate timers were left running concurrently,
 * which inflates task-hours. Flags the group (pinned to its latest session).
 */
export function duplicateSessions(group: {
  userId: string;
  taskId: string | null;
  latestSessionId: string;
  overlappingCount: number;
  label: string;
}): FlagCandidate | null {
  if (group.overlappingCount < 2) return null;
  return {
    type: 'duplicate_session',
    userId: group.userId,
    sessionId: group.latestSessionId,
    taskId: group.taskId,
    detail: `${group.overlappingCount} overlapping sessions on "${group.label}" — likely duplicate timers. Counted once toward task-hours.`,
  };
}

/**
 * activity_no_session: a git-event with no session covering its time on that
 * task/repo for its author.
 */
export function activityNoSession(ev: {
  id: string;
  authorUserId: string | null;
  covered: boolean;
}): FlagCandidate | null {
  if (!ev.authorUserId || ev.covered) return null;
  return {
    type: 'activity_no_session',
    userId: ev.authorUserId,
    gitEventId: ev.id,
    detail: 'Git activity with no session covering its time.',
  };
}
