// DTO mapping helpers (DB rows → @cadence/shared DTOs).
import type { Session, Task, ActivitySegment } from '@cadence/db';
import type { ActivityType, SessionDTO, TaskDTO } from '@cadence/shared';
import { sumMinutes } from '../engine/sessionMath';

export function taskOrigin(t: Pick<Task, 'source' | 'githubNumber' | 'branch'>): string {
  if (t.source === 'issue') return `#${t.githubNumber ?? '?'}`;
  if (t.source === 'pr') return `PR #${t.githubNumber ?? '?'}`;
  if (t.source === 'manual') return t.branch ?? 'task';
  return t.branch ?? 'branch';
}

/** The title shown in-app: the dev's local rename wins over the synced title. */
export function taskDisplayTitle(t: Pick<Task, 'title' | 'displayTitle'>): string {
  return t.displayTitle ?? t.title;
}

export function actualMinutes(
  sessions: Pick<Session, 'startedAt' | 'endedAt'>[],
  now = Date.now(),
): number {
  return sumMinutes(
    sessions.map((s) => ({
      start: s.startedAt.getTime(),
      end: (s.endedAt ?? new Date(now)).getTime(),
    })),
  );
}

export function taskToDTO(
  t: Task & { repo: { fullName: string } | null; sessions: Pick<Session, 'startedAt' | 'endedAt'>[] },
): TaskDTO {
  return {
    id: t.id,
    repoFullName: t.repo?.fullName ?? null,
    source: t.source,
    githubNumber: t.githubNumber,
    branch: t.branch,
    title: taskDisplayTitle(t),
    status: t.status,
    estimateMinutes: t.estimateMinutes,
    actualMinutes: actualMinutes(t.sessions),
    reopenCount: t.reopenCount,
    assigneeUserId: t.assigneeUserId,
    description: t.description,
    plan: t.plan,
    planApproved: t.planApproved,
    origin: taskOrigin(t),
  };
}

/** Map a Task (+ assignee/members joined) to the admin ManagedTask DTO. */
export function managedTaskToDTO(
  t: Task & {
    repo: { fullName: string } | null;
    sessions: Pick<Session, 'startedAt' | 'endedAt'>[];
    members: { user: { id: string; githubLogin: string; name: string | null; avatarUrl: string | null } }[];
  },
  assignee: { id: string; githubLogin: string; name: string | null; avatarUrl: string | null } | null,
): import('@cadence/shared').ManagedTask {
  return {
    ...taskToDTO(t),
    assignee: assignee
      ? { id: assignee.id, githubLogin: assignee.githubLogin, name: assignee.name, avatarUrl: assignee.avatarUrl }
      : null,
    members: t.members.map((m) => ({
      id: m.user.id,
      githubLogin: m.user.githubLogin,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
    })),
    createdAt: t.createdAt.toISOString(),
  };
}

export function dominantSegment(segments: ActivitySegment[]): ActivityType | null {
  if (segments.length === 0) return null;
  const tally = new Map<ActivityType, number>();
  for (const s of segments) {
    const dur = s.endedAt.getTime() - s.startedAt.getTime();
    tally.set(s.type, (tally.get(s.type) ?? 0) + dur);
  }
  let best: ActivityType | null = null;
  let bestN = -1;
  for (const [t, n] of tally) {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

export function sessionToDTO(s: Session & { segments: ActivitySegment[] }): SessionDTO {
  return {
    id: s.id,
    userId: s.userId,
    taskId: s.taskId,
    offTaskLabel: s.offTaskLabel,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    isOpen: s.isOpen,
    intent: s.intent,
    summary: s.summary,
    blocked: s.blocked,
    segments: s.segments.map((seg) => ({
      type: seg.type,
      source: seg.source,
      startedAt: seg.startedAt.toISOString(),
      endedAt: seg.endedAt.toISOString(),
    })),
    inferredActivity: dominantSegment(s.segments),
  };
}
