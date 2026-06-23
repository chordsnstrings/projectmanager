// DTO mapping helpers (DB rows → @cadence/shared DTOs).
import type { Session, Task, ActivitySegment } from '@cadence/db';
import type { ActivityType, SessionDTO, TaskDTO } from '@cadence/shared';
import { sumMinutes } from '../engine/sessionMath';

export function taskOrigin(t: Pick<Task, 'source' | 'githubNumber' | 'branch'>): string {
  if (t.source === 'issue') return `#${t.githubNumber ?? '?'}`;
  if (t.source === 'pr') return `PR #${t.githubNumber ?? '?'}`;
  return t.branch ?? 'branch';
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
  t: Task & { repo: { fullName: string }; sessions: Pick<Session, 'startedAt' | 'endedAt'>[] },
): TaskDTO {
  return {
    id: t.id,
    repoFullName: t.repo.fullName,
    source: t.source,
    githubNumber: t.githubNumber,
    branch: t.branch,
    title: t.title,
    status: t.status,
    estimateMinutes: t.estimateMinutes,
    actualMinutes: actualMinutes(t.sessions),
    reopenCount: t.reopenCount,
    origin: taskOrigin(t),
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
