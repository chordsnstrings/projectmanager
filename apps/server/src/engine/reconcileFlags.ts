// Recompute time-based flags + persist them (deduped). Driven by the SCHEDULED
// reconcile job (§6/§10) and reusable from the webhook path.
import type { Db } from '../sync/upsert';
import { env } from '../env';
import { duplicateSessions, longOpenSession, openNoActivity, overrun, type FlagCandidate } from './flags';
import { hasConcurrency, unionMinutes } from './sessionMath';
import { dominantActivity } from './activity';
import { TEAM_ACTIVITIES } from '@cadence/shared';
import { localToday, resolveTz, startOfLocalDay } from '../lib/tz';

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
    include: { segments: { take: 1 }, user: { select: { team: { select: { key: true } } } } },
  });
  for (const s of sessions) {
    if (s.segments.length > 0 || !s.taskId) continue;
    // Git inference is per-team: skip teams that tag activity manually (e.g. marketing).
    if (!TEAM_ACTIVITIES[s.user.team?.key ?? '']?.inferFromGit) continue;
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

/**
 * Create the flag unless one of the same identity already exists — in ANY
 * status. Each candidate is keyed to a concrete object (a session, a task, or a
 * git-event), so once an admin resolves or dismisses it we must not raise it
 * again for that same object on the next reconcile; otherwise resolved/dismissed
 * flags reappear within minutes. A genuinely new occurrence has a different
 * session/task/git-event id and still gets its own flag.
 */
export async function persistFlagCandidate(db: Db, c: FlagCandidate): Promise<boolean> {
  const existing = await db.flag.findFirst({
    where: {
      type: c.type,
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

/**
 * Daily hygiene: a session left open from a previous day is auto-closed at that
 * day's rollover (UTC midnight). Keeps each day's record self-contained so the
 * dashboard doesn't accumulate stale "running" sessions across days.
 */
export async function autoCloseStaleDays(db: Db, now = Date.now()): Promise<number> {
  // Close sessions a dev forgot to stop overnight — judged against *their own*
  // local midnight, so working past UTC midnight isn't cut off mid-flow.
  const open = await db.session.findMany({
    where: { isOpen: true, deletedAt: null },
    include: { user: { select: { timezone: true } } },
  });
  let closed = 0;
  for (const s of open) {
    const tz = resolveTz(s.user.timezone);
    const todayStart = startOfLocalDay(localToday(tz, new Date(now)), tz);
    if (s.startedAt < todayStart) {
      await db.session.update({ where: { id: s.id }, data: { isOpen: false, endedAt: todayStart } });
      closed++;
    }
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
    // one task → union (duplicate timers on the same task must not trigger overrun)
    const actualMinutes = unionMinutes(
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

  // ── Duplicate concurrent timers on the same task/off-task → duplicate_session ─
  const since = new Date(now - 3 * 86_400_000);
  const recent = await db.session.findMany({
    where: { deletedAt: null, startedAt: { gte: since } },
    orderBy: { startedAt: 'asc' },
  });
  type Grp = { userId: string; taskId: string | null; label: string; ivs: { start: number; end: number }[]; latestId: string; latestStart: number };
  const groups = new Map<string, Grp>();
  for (const s of recent) {
    const key = `${s.userId}:${s.taskId ?? `offtask:${s.offTaskLabel ?? 'off-task'}`}`;
    const start = s.startedAt.getTime();
    const end = (s.endedAt ?? new Date(now)).getTime();
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        userId: s.userId,
        taskId: s.taskId,
        label: s.offTaskLabel ?? 'this task',
        ivs: [{ start, end }],
        latestId: s.id,
        latestStart: start,
      });
    } else {
      g.ivs.push({ start, end });
      if (start >= g.latestStart) {
        g.latestStart = start;
        g.latestId = s.id;
      }
    }
  }
  for (const g of groups.values()) {
    if (g.ivs.length < 2 || !hasConcurrency(g.ivs)) continue;
    const cand = duplicateSessions({
      userId: g.userId,
      taskId: g.taskId,
      latestSessionId: g.latestId,
      overlappingCount: g.ivs.length,
      label: g.label,
    });
    if (cand && (await persistFlagCandidate(db, cand))) flagsCreated++;
  }

  return { openSessions: open.length, flagsCreated };
}
