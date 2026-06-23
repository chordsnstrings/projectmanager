// Productivity / progress / completion / version rollups (§ "how far they've
// come"). Reuses the same union/grouped session math as the dashboards so the
// numbers agree with the timeline.
import { prisma } from '@cadence/db';
import type {
  CompletionItem,
  Productivity,
  ProductivityWindow,
  Progress,
  ProgressPoint,
  MilestoneRollup,
  VersionRollup,
} from '@cadence/shared';
import { groupedTaskMinutes, unionMinutes, type Interval } from '../engine/sessionMath';
import { addDays, localDayRange, localToday, resolveTz } from '../lib/tz';
import { taskOrigin } from './map';

type SessionRow = { taskId: string | null; offTaskLabel: string | null; startedAt: Date; endedAt: Date | null };

/** active = union of sessions; taskHours = sum of per-task unions. */
function windowMath(sessions: SessionRow[], start: number, end: number, now: number) {
  const clip = (s: SessionRow): Interval => ({
    start: Math.max(s.startedAt.getTime(), start),
    end: Math.min((s.endedAt ?? new Date(now)).getTime(), end),
  });
  const flat = sessions.map(clip);
  const byTask = new Map<string, Interval[]>();
  for (const s of sessions) {
    const key = s.taskId ?? `offtask:${s.offTaskLabel ?? 'off-task'}`;
    byTask.set(key, [...(byTask.get(key) ?? []), clip(s)]);
  }
  return {
    activeMinutes: unionMinutes(flat),
    taskHoursMinutes: groupedTaskMinutes([...byTask.values()]),
    sessions: sessions.length,
  };
}

async function windowStats(userId: string, start: Date, end: Date): Promise<ProductivityWindow> {
  const now = Date.now();
  const sessions = await prisma.session.findMany({
    where: {
      userId,
      deletedAt: null,
      startedAt: { lt: end },
      OR: [{ endedAt: null }, { endedAt: { gt: start } }],
    },
    select: { taskId: true, offTaskLabel: true, startedAt: true, endedAt: true },
  });
  const m = windowMath(sessions, start.getTime(), end.getTime(), now);
  const completed = await prisma.task.count({
    where: { assigneeUserId: userId, deletedAt: null, status: 'done', closedAt: { gte: start, lte: end } },
  });
  return { ...m, completed };
}

/** Board summary: today + the last 7 local days, in the user's tz. */
export async function buildProductivity(userId: string): Promise<Productivity> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const tz = resolveTz(user.timezone);
  const todayStr = localToday(tz);
  const todayRange = localDayRange(todayStr, tz);
  const weekStart = localDayRange(addDays(todayStr, -6), tz).start; // 7 days incl. today
  const [today, week] = await Promise.all([
    windowStats(userId, todayRange.start, todayRange.end),
    windowStats(userId, weekStart, todayRange.end),
  ]);
  return { timezone: tz, today, week };
}

/** Per-week progress + milestone + version rollups for self-review / admin. */
export async function buildProgress(userId: string, weeks = 8): Promise<Progress> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const tz = resolveTz(user.timezone);
  const now = Date.now();

  const points: ProgressPoint[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekEnd = new Date(now - w * 7 * 86_400_000);
    const weekStart = new Date(weekEnd.getTime() - 7 * 86_400_000);
    const sessions = await prisma.session.findMany({
      where: {
        userId,
        deletedAt: null,
        startedAt: { lt: weekEnd },
        OR: [{ endedAt: null }, { endedAt: { gt: weekStart } }],
      },
      select: { taskId: true, offTaskLabel: true, startedAt: true, endedAt: true },
    });
    const m = windowMath(sessions, weekStart.getTime(), weekEnd.getTime(), now);
    const completed = await prisma.task.count({
      where: { assigneeUserId: userId, deletedAt: null, status: 'done', closedAt: { gte: weekStart, lte: weekEnd } },
    });
    points.push({
      weekStart: weekStart.toISOString(),
      completed,
      activeMinutes: m.activeMinutes,
      taskHoursMinutes: m.taskHoursMinutes,
    });
  }

  const [totalCompleted, openCount, inReviewCount] = await Promise.all([
    prisma.task.count({ where: { assigneeUserId: userId, deletedAt: null, status: 'done' } }),
    prisma.task.count({ where: { assigneeUserId: userId, deletedAt: null, status: { in: ['todo', 'in_progress', 'in_review'] } } }),
    prisma.task.count({ where: { assigneeUserId: userId, deletedAt: null, status: 'in_review' } }),
  ]);
  const completionRate = totalCompleted + openCount > 0 ? totalCompleted / (totalCompleted + openCount) : 0;

  // Milestones: group the user's tasks by GitHub milestone title.
  const milestoneTasks = await prisma.task.findMany({
    where: { assigneeUserId: userId, deletedAt: null, milestoneTitle: { not: null } },
    select: { milestoneTitle: true, milestoneDueOn: true, status: true },
  });
  const mMap = new Map<string, { dueOn: Date | null; total: number; done: number }>();
  for (const t of milestoneTasks) {
    const key = t.milestoneTitle as string;
    const g = mMap.get(key) ?? { dueOn: t.milestoneDueOn, total: 0, done: 0 };
    g.total++;
    if (t.status === 'done') g.done++;
    if (t.milestoneDueOn && (!g.dueOn || t.milestoneDueOn < g.dueOn)) g.dueOn = t.milestoneDueOn;
    mMap.set(key, g);
  }
  const milestones: MilestoneRollup[] = [...mMap.entries()]
    .map(([title, g]) => ({
      title,
      dueOn: g.dueOn ? g.dueOn.toISOString() : null,
      total: g.total,
      done: g.done,
      pct: g.total > 0 ? Math.round((g.done / g.total) * 100) : 0,
    }))
    .sort((a, b) => a.pct - b.pct);

  // Versions: latest release per repo the user has tasks in.
  const repos = await prisma.repo.findMany({
    where: { deletedAt: null, latestVersion: { not: null }, tasks: { some: { assigneeUserId: userId, deletedAt: null } } },
    select: { fullName: true, latestVersion: true, latestVersionAt: true },
    orderBy: { latestVersionAt: 'desc' },
    take: 20,
  });
  const versions: VersionRollup[] = repos.map((r) => ({
    repoFullName: r.fullName,
    version: r.latestVersion as string,
    at: r.latestVersionAt ? r.latestVersionAt.toISOString() : null,
  }));

  return {
    userId,
    githubLogin: user.githubLogin,
    totalCompleted,
    openCount,
    inReviewCount,
    completionRate,
    points,
    milestones,
    versions,
  };
}

const PAGE = 30;

/** Paginated completion log (done tasks, newest first) for a user. */
export async function listCompletions(
  userId: string,
  cursor?: string,
): Promise<{ items: CompletionItem[]; nextCursor: string | null }> {
  const now = Date.now();
  const rows = await prisma.task.findMany({
    where: { assigneeUserId: userId, deletedAt: null, status: 'done' },
    include: {
      repo: { select: { fullName: true } },
      sessions: { where: { deletedAt: null }, select: { startedAt: true, endedAt: true } },
    },
    orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const items: CompletionItem[] = rows.slice(0, PAGE).map((t) => ({
    taskId: t.id,
    title: t.displayTitle ?? t.title,
    repoFullName: t.repo.fullName,
    origin: taskOrigin(t),
    status: t.status,
    milestoneTitle: t.milestoneTitle,
    estimateMinutes: t.estimateMinutes,
    actualMinutes: unionMinutes(
      t.sessions.map((s) => ({ start: s.startedAt.getTime(), end: (s.endedAt ?? new Date(now)).getTime() })),
    ),
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
  }));
  const nextCursor = rows.length > PAGE ? (rows[PAGE]?.id ?? null) : null;
  return { items, nextCursor };
}
