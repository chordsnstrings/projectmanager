// Recompute time-based flags + persist them (deduped). Driven by the SCHEDULED
// reconcile job (§6/§10) and reusable from the webhook path.
import type { Db } from '../sync/upsert';
import { env } from '../env';
import { longOpenSession, openNoActivity, overrun, type FlagCandidate } from './flags';
import { sumMinutes } from './sessionMath';
import { dominantActivity } from './activity';

/**
 * Generate one inferred ActivitySegment per recent session that has commits but
 * no segments yet, typed by the dominant activity of those commits. This is what
 * colors the day-timeline bars (§9b) when segments weren't set by a manual tap.
 */
export async function generateInferredSegments(db: Db, now = Date.now()): Promise<number> {
  let created = 0;
  const since = new Date(now - 3 * 86_400_000);
  const sessions = await db.session.findMany({
    where: { deletedAt: null, taskId: { not: null }, startedAt: { gte: since } },
    include: { segments: { take: 1 } },
  });
  for (const s of sessions) {
    if (s.segments.length > 0 || !s.taskId) continue;
    const end = s.endedAt ?? new Date(now);
    const commits = await db.gitEvent.findMany({
      where: { type: 'commit', taskId: s.taskId, occurredAt: { gte: s.startedAt, lte: end } },
    });
    if (commits.length === 0) continue;
    const type =
      dominantActivity(
        commits.map((c) => ({ message: c.message, additions: c.additions, occurredAt: c.occurredAt.getTime() })),
      ) ?? 'coding';
    await db.activitySegment.create({
      data: { sessionId: s.id, type, source: 'inferred', startedAt: s.startedAt, endedAt: end },
    });
    created++;
  }
  return created;
}

/** Create the flag if an equivalent OPEN one doesn't already exist (idempotent). */
export async function persistFlagCandidate(db: Db, c: FlagCandidate): Promise<boolean> {
  const existing = await db.flag.findFirst({
    where: {
      type: c.type,
      status: 'open',
      sessionId: c.sessionId ?? null,
      taskId: c.taskId ?? null,
      gitEventId: c.gitEventId ?? null,
    },
  });
  if (existing) return false;
  const created = await db.flag.create({
    data: {
      type: c.type,
      userId: c.userId,
      sessionId: c.sessionId ?? null,
      taskId: c.taskId ?? null,
      gitEventId: c.gitEventId ?? null,
      detail: c.detail,
    },
  });
  // Lightweight audit trail (P6).
  console.log(JSON.stringify({ audit: 'flag.created', flagId: created.id, type: c.type, userId: c.userId }));
  return true;
}

/**
 * For users who opted into "stop on commit", close a task's open session at the
 * time of the first commit that lands after the session started.
 */
export async function autoStopOnCommit(db: Db, _now = Date.now()): Promise<number> {
  let closed = 0;
  const open = await db.session.findMany({
    where: { isOpen: true, deletedAt: null, taskId: { not: null }, user: { stopOnCommit: true } },
  });
  for (const s of open) {
    if (!s.taskId) continue;
    const commit = await db.gitEvent.findFirst({
      where: { type: 'commit', taskId: s.taskId, occurredAt: { gt: s.startedAt } },
      orderBy: { occurredAt: 'asc' },
    });
    if (!commit) continue;
    await db.session.update({
      where: { id: s.id },
      data: { isOpen: false, endedAt: commit.occurredAt },
    });
    closed++;
  }
  return closed;
}

export interface ReconcileResult {
  openSessions: number;
  flagsCreated: number;
}

export async function reconcileFlags(db: Db, now = Date.now()): Promise<ReconcileResult> {
  let flagsCreated = 0;

  // ── Open sessions → open_no_activity, long_open_session ───────────────────
  const open = await db.session.findMany({
    where: { isOpen: true, deletedAt: null },
  });
  for (const s of open) {
    const startedAt = s.startedAt.getTime();
    // git activity inside the session window (by task, else by author)
    const innerGitEvents = await db.gitEvent.count({
      where: {
        occurredAt: { gte: s.startedAt },
        ...(s.taskId ? { taskId: s.taskId } : { authorUserId: s.userId }),
      },
    });
    const view = {
      id: s.id,
      userId: s.userId,
      taskId: s.taskId,
      startedAt,
      endedAt: null as number | null,
      innerGitEvents,
    };
    for (const cand of [
      openNoActivity(view, now, env.IDLE_MINUTES),
      longOpenSession(view, now, env.MAX_OPEN_HOURS),
    ]) {
      if (cand && (await persistFlagCandidate(db, cand))) flagsCreated++;
    }
  }

  // ── Tasks with estimates → overrun ────────────────────────────────────────
  const tasks = await db.task.findMany({
    where: { deletedAt: null, estimateMinutes: { not: null }, assigneeUserId: { not: null } },
    include: { sessions: { where: { deletedAt: null } } },
  });
  for (const t of tasks) {
    const actualMinutes = sumMinutes(
      t.sessions.map((s) => ({
        start: s.startedAt.getTime(),
        end: (s.endedAt ?? new Date(now)).getTime(),
      })),
    );
    const cand = overrun(
      {
        id: t.id,
        estimateMinutes: t.estimateMinutes,
        actualMinutes,
        assigneeUserId: t.assigneeUserId,
      },
      env.OVERRUN_FACTOR,
    );
    if (cand && (await persistFlagCandidate(db, cand))) flagsCreated++;
  }

  return { openSessions: open.length, flagsCreated };
}
