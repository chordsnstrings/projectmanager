// Dashboard aggregations (§9b). active-elapsed = union of session intervals;
// task-hours = sum (overlaps double-counted). Never add overlaps for elapsed.
import { prisma } from '@cadence/db';
import type {
  DayTimeline,
  FlagDTO,
  TeamDashboard,
  TeamDay,
  TeamDayMember,
  TeamMemberRollup,
  TimelineLane,
  TimelineSession,
  Trends,
  TrendPoint,
} from '@cadence/shared';
import { groupedTaskMinutes, sumMinutes, unionMinutes, type Interval } from '../engine/sessionMath';
import { taskOrigin } from './map';
import { localDayRange, localToday, resolveTz } from '../lib/tz';

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function clip(iv: Interval, start: number, end: number): Interval {
  return { start: Math.max(iv.start, start), end: Math.min(iv.end, end) };
}

export async function buildTeamDashboard(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<TeamDashboard> {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const users = await prisma.user.findMany({ where: { deletedAt: null } });
  const now = Date.now();

  const members: TeamMemberRollup[] = [];
  for (const u of users) {
    const sessions = await prisma.session.findMany({
      where: {
        userId: u.id,
        deletedAt: null,
        startedAt: { lt: rangeEnd },
        OR: [{ endedAt: null }, { endedAt: { gt: rangeStart } }],
      },
      include: { task: { select: { title: true, displayTitle: true } } },
    });
    const intervals: Interval[] = sessions.map((s) =>
      clip({ start: s.startedAt.getTime(), end: (s.endedAt ?? new Date(now)).getTime() }, startMs, endMs),
    );
    // Group intervals per task/off-task so same-task overlap (duplicate timers)
    // collapses, while different tasks still add toward task-hours.
    const byTask = new Map<string, Interval[]>();
    for (const s of sessions) {
      const key = s.taskId ?? `offtask:${s.offTaskLabel ?? 'off-task'}`;
      const iv = clip({ start: s.startedAt.getTime(), end: (s.endedAt ?? new Date(now)).getTime() }, startMs, endMs);
      byTask.set(key, [...(byTask.get(key) ?? []), iv]);
    }
    const openFlagCount = await prisma.flag.count({ where: { userId: u.id, status: 'open' } });
    const closedTasks = await prisma.task.findMany({
      where: {
        assigneeUserId: u.id,
        deletedAt: null,
        closedAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { estimateMinutes: true, sessions: { select: { startedAt: true, endedAt: true } } },
    });
    const accuracies = closedTasks
      .filter((t) => t.estimateMinutes && t.estimateMinutes > 0)
      .map((t) => {
        // one task → union (duplicate timers on the same task shouldn't inflate)
        const actual = unionMinutes(
          t.sessions.map((s) => ({
            start: s.startedAt.getTime(),
            end: (s.endedAt ?? new Date(now)).getTime(),
          })),
        );
        return actual / (t.estimateMinutes as number);
      });

    const lastSession = sessions.reduce<number | null>((acc, s) => {
      const t = (s.endedAt ?? s.startedAt).getTime();
      return acc === null || t > acc ? t : acc;
    }, null);

    members.push({
      userId: u.id,
      githubLogin: u.githubLogin,
      name: u.name,
      avatarUrl: u.avatarUrl,
      activeElapsedMinutes: unionMinutes(intervals),
      taskHoursMinutes: groupedTaskMinutes([...byTask.values()]),
      sessionCount: sessions.length,
      openFlagCount,
      runningTaskTitles: sessions
        .filter((s) => s.isOpen)
        .map((s) => s.task?.displayTitle ?? s.task?.title ?? s.offTaskLabel ?? 'off-task'),
      lastActiveAt: lastSession ? new Date(lastSession).toISOString() : null,
      tasksClosed: closedTasks.length,
      estimateAccuracy: median(accuracies),
    });
  }

  return {
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    members,
  };
}

/**
 * The whole team's day on one shared wall-clock axis (the admin's local day),
 * one compact row per member. Concurrency across people is real (absolute time);
 * labels are rendered in the admin's timezone.
 */
export async function buildTeamDay(adminUserId: string, dateArg?: string): Promise<TeamDay> {
  const now = Date.now();
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminUserId } });
  const tz = resolveTz(admin.timezone);
  const date = dateArg || localToday(tz);
  const { start: dayStart, end: dayEnd } = localDayRange(date, tz);
  const startMs = dayStart.getTime();
  const endMs = dayEnd.getTime();

  const users = await prisma.user.findMany({ where: { deletedAt: null }, orderBy: { githubLogin: 'asc' } });
  const members: TeamDayMember[] = [];
  for (const u of users) {
    const sessions = await prisma.session.findMany({
      where: {
        userId: u.id,
        deletedAt: null,
        startedAt: { lt: dayEnd },
        OR: [{ endedAt: null }, { endedAt: { gt: dayStart } }],
      },
      include: { segments: true, task: { select: { title: true, displayTitle: true } } },
      orderBy: { startedAt: 'asc' },
    });
    const intervals: Interval[] = sessions.map((s) =>
      clip({ start: s.startedAt.getTime(), end: (s.endedAt ?? new Date(now)).getTime() }, startMs, endMs),
    );
    const openFlagCount = await prisma.flag.count({ where: { userId: u.id, status: 'open' } });
    members.push({
      userId: u.id,
      githubLogin: u.githubLogin,
      name: u.name,
      avatarUrl: u.avatarUrl,
      activeElapsedMinutes: unionMinutes(intervals),
      sessionCount: sessions.length,
      openFlagCount,
      runningTitles: sessions
        .filter((s) => s.isOpen)
        .map((s) => s.task?.displayTitle ?? s.task?.title ?? s.offTaskLabel ?? 'off-task'),
      sessions: sessions.map((s) => ({
        id: s.id,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        isOpen: s.isOpen,
        title: s.task?.displayTitle ?? s.task?.title ?? s.offTaskLabel ?? 'off-task',
        segments: s.segments.map((seg) => ({
          type: seg.type,
          source: seg.source,
          startedAt: seg.startedAt.toISOString(),
          endedAt: seg.endedAt.toISOString(),
        })),
      })),
    });
  }

  return {
    date,
    timezone: tz,
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
    members,
  };
}

export async function buildDayTimeline(userId: string, dateArg?: string): Promise<DayTimeline> {
  const now = Date.now();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const tz = resolveTz(user.timezone);
  const date = dateArg || localToday(tz);
  const { start: dayStart, end: dayEnd } = localDayRange(date, tz);

  const sessions = await prisma.session.findMany({
    where: {
      userId,
      deletedAt: null,
      startedAt: { lt: dayEnd },
      OR: [{ endedAt: null }, { endedAt: { gt: dayStart } }],
    },
    include: { segments: true, task: { include: { repo: { select: { fullName: true } } } } },
    orderBy: { startedAt: 'asc' },
  });

  const dayFlags = await prisma.flag.findMany({
    where: { userId, createdAt: { gte: dayStart, lte: dayEnd } },
  });
  const flagsBySession = new Map<string, string[]>();
  for (const f of dayFlags) {
    if (f.sessionId) {
      flagsBySession.set(f.sessionId, [...(flagsBySession.get(f.sessionId) ?? []), f.id]);
    }
  }

  const sessionIds = sessions.map((s) => s.id);
  const dayQuestions = await prisma.question.findMany({
    where: {
      targetUserId: userId,
      OR: [
        { sessionId: { in: sessionIds } },
        { createdAt: { gte: dayStart, lte: dayEnd } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  const questionsBySession = new Map<string, string[]>();
  for (const q of dayQuestions) {
    if (q.sessionId) {
      questionsBySession.set(q.sessionId, [...(questionsBySession.get(q.sessionId) ?? []), q.id]);
    }
  }

  // group sessions into lanes by taskId (off-task → its own lane keyed by label)
  const laneMap = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = s.taskId ?? `offtask:${s.offTaskLabel ?? 'off-task'}`;
    laneMap.set(key, [...(laneMap.get(key) ?? []), s]);
  }

  const lanes: TimelineLane[] = [];
  for (const [key, laneSessions] of laneMap) {
    const first = laneSessions[0]!;
    const task = first.task;
    const commitsBySession = new Map<string, TimelineSession['commits']>();
    for (const s of laneSessions) {
      const end = s.endedAt ?? new Date(now);
      const commits = await prisma.gitEvent.findMany({
        where: {
          type: 'commit',
          occurredAt: { gte: s.startedAt, lte: end },
          ...(s.taskId ? { taskId: s.taskId } : { authorUserId: userId }),
        },
        orderBy: { occurredAt: 'asc' },
      });
      commitsBySession.set(
        s.id,
        commits.map((c) => ({
          sha: c.sha ?? '',
          message: c.message ?? '',
          additions: c.additions,
          deletions: c.deletions,
          filesChanged: c.filesChanged,
          occurredAt: c.occurredAt.toISOString(),
        })),
      );
    }

    const timelineSessions: TimelineSession[] = laneSessions.map((s) => ({
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt ? s.endedAt.toISOString() : null,
      isOpen: s.isOpen,
      intent: s.intent,
      summary: s.summary,
      offTaskLabel: s.offTaskLabel,
      segments: s.segments.map((seg) => ({
        type: seg.type,
        source: seg.source,
        startedAt: seg.startedAt.toISOString(),
        endedAt: seg.endedAt.toISOString(),
      })),
      commits: commitsBySession.get(s.id) ?? [],
      flagIds: flagsBySession.get(s.id) ?? [],
      questionIds: questionsBySession.get(s.id) ?? [],
    }));

    // One lane = one task → union (overlapping/duplicate timers on the same task
    // are the same work and must not double-count).
    const actual = unionMinutes(
      laneSessions.map((s) => ({
        start: s.startedAt.getTime(),
        end: (s.endedAt ?? new Date(now)).getTime(),
      })),
    );

    lanes.push({
      taskId: task?.id ?? null,
      title: task?.displayTitle ?? task?.title ?? first.offTaskLabel ?? 'Off-task',
      origin: task ? taskOrigin(task) : 'off-task',
      repoFullName: task?.repo.fullName ?? '—',
      estimateMinutes: task?.estimateMinutes ?? null,
      actualMinutes: actual,
      varianceMinutes: task?.estimateMinutes ? actual - task.estimateMinutes : null,
      status: task?.status ?? 'in_progress',
      sessionCount: laneSessions.length,
      reopenCount: task?.reopenCount ?? 0,
      sessions: timelineSessions,
    });
    void key;
  }

  const allIntervals: Interval[] = sessions.map((s) => ({
    start: s.startedAt.getTime(),
    end: (s.endedAt ?? new Date(now)).getTime(),
  }));

  return {
    userId,
    githubLogin: user.githubLogin,
    date,
    timezone: tz,
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
    activeElapsedMinutes: unionMinutes(allIntervals),
    // sum of per-lane (per-task) unions — cross-task concurrency adds, same-task
    // overlap does not.
    taskHoursMinutes: lanes.reduce((acc, l) => acc + l.actualMinutes, 0),
    sessionCount: sessions.length,
    flags: dayFlags.map(
      (f): FlagDTO => ({
        id: f.id,
        type: f.type,
        userId: f.userId,
        sessionId: f.sessionId,
        taskId: f.taskId,
        detail: f.detail,
        status: f.status,
        createdAt: f.createdAt.toISOString(),
      }),
    ),
    questions: dayQuestions.map((q) => ({
      id: q.id,
      adminUserId: q.adminUserId,
      targetUserId: q.targetUserId,
      taskId: q.taskId,
      sessionId: q.sessionId,
      body: q.body,
      blocksNext: q.blocksNext,
      status: q.status,
      answer: q.answer,
      createdAt: q.createdAt.toISOString(),
      answeredAt: q.answeredAt ? q.answeredAt.toISOString() : null,
    })),
    lanes,
  };
}

export async function buildTrends(userId: string, weeks = 8): Promise<Trends> {
  const now = new Date();
  const points: TrendPoint[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekEnd = new Date(now.getTime() - w * 7 * 86400_000);
    const weekStart = new Date(weekEnd.getTime() - 7 * 86400_000);

    const closed = await prisma.task.findMany({
      where: {
        assigneeUserId: userId,
        deletedAt: null,
        closedAt: { gte: weekStart, lte: weekEnd },
      },
      select: {
        estimateMinutes: true,
        reopenCount: true,
        createdAt: true,
        closedAt: true,
        sessions: { select: { startedAt: true, endedAt: true } },
      },
    });
    const accuracies: number[] = [];
    const cycleTimes: number[] = [];
    const touchTimes: number[] = [];
    let reopened = 0;
    for (const t of closed) {
      const actual = sumMinutes(
        t.sessions.map((s) => ({
          start: s.startedAt.getTime(),
          end: (s.endedAt ?? weekEnd).getTime(),
        })),
      );
      touchTimes.push(actual);
      if (t.estimateMinutes && t.estimateMinutes > 0) accuracies.push(actual / t.estimateMinutes);
      if (t.closedAt) cycleTimes.push(Math.round((t.closedAt.getTime() - t.createdAt.getTime()) / 60000));
      if (t.reopenCount > 0) reopened++;
    }
    const flagCount = await prisma.flag.count({
      where: { userId, createdAt: { gte: weekStart, lte: weekEnd } },
    });
    const segs = await prisma.activitySegment.findMany({
      where: { session: { userId }, startedAt: { gte: weekStart, lte: weekEnd } },
    });
    const activityMix: TrendPoint['activityMix'] = {};
    for (const s of segs) {
      const dur = s.endedAt.getTime() - s.startedAt.getTime();
      activityMix[s.type] = (activityMix[s.type] ?? 0) + Math.round(dur / 60000);
    }

    points.push({
      weekStart: weekStart.toISOString(),
      estimateAccuracy: median(accuracies),
      reworkRate: closed.length ? reopened / closed.length : null,
      flagCount,
      cycleTimeMinutes: median(cycleTimes),
      touchTimeMinutes: median(touchTimes),
      activityMix,
    });
  }
  return { userId, points };
}
