// Morning "start your day" check-in: yesterday recap + today's plan, and the
// admin "Pulse" aggregates (felt-vs-measured, sentiment, blockers, carry-over).
import { prisma } from '@cadence/db';
import type {
  BlockerKey,
  CarryoverItem,
  CheckinPrompt,
  CheckinSubmit,
  PulseInsights,
  PulseMember,
} from '@cadence/shared';
import { unionMinutes } from '../engine/sessionMath';
import { addDays, localDayRange, localToday, localWeekday, resolveTz } from '../lib/tz';

const OPEN_STATUSES = ['todo', 'in_progress', 'in_review'] as const;

async function measuredFor(userId: string, start: Date, end: Date) {
  const now = Date.now();
  const sessions = await prisma.session.findMany({
    where: { userId, deletedAt: null, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
    select: { startedAt: true, endedAt: true },
  });
  const activeMinutes = unionMinutes(
    sessions.map((s) => ({
      start: Math.max(s.startedAt.getTime(), start.getTime()),
      end: Math.min((s.endedAt ?? new Date(now)).getTime(), end.getTime()),
    })),
  );
  const completed = await prisma.task.count({
    where: { assigneeUserId: userId, deletedAt: null, status: 'done', closedAt: { gte: start, lte: end } },
  });
  return { activeMinutes, completed };
}

/** Build the prompt: is a check-in needed today, plus yesterday's measured recap + open tasks. */
export async function buildCheckinPrompt(userId: string): Promise<CheckinPrompt> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const tz = resolveTz(user.timezone);
  const today = localToday(tz);
  const yesterday = addDays(today, -1);
  const yRange = localDayRange(yesterday, tz);

  const existing = await prisma.dailyCheckin.findUnique({ where: { userId_localDate: { userId, localDate: today } } });
  const [{ activeMinutes, completed }, openTasks, inProgress] = await Promise.all([
    measuredFor(userId, yRange.start, yRange.end),
    prisma.task.findMany({
      where: { assigneeUserId: userId, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
      select: { id: true, title: true, displayTitle: true },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    }),
    prisma.task.count({ where: { assigneeUserId: userId, deletedAt: null, status: { in: ['in_progress', 'in_review'] } } }),
  ]);

  return {
    needed: !existing,
    localDate: today,
    weekday: localWeekday(new Date(), tz) >= 1 && localWeekday(new Date(), tz) <= 5,
    yesterday: { activeMinutes, completed, inProgress, date: yesterday },
    openTasks: openTasks.map((t) => ({ id: t.id, title: t.displayTitle ?? t.title })),
  };
}

const BLOCKERS: BlockerKey[] = ['review', 'requirements', 'bug', 'meetings', 'none', 'other'];

/** Record (or skip) today's check-in. Stores a measured snapshot for felt-vs-measured. */
export async function submitCheckin(userId: string, body: CheckinSubmit, skip = false): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const tz = resolveTz(user.timezone);
  const today = localToday(tz);
  const yRange = localDayRange(addDays(today, -1), tz);
  const measured = skip ? { activeMinutes: 0, completed: 0 } : await measuredFor(userId, yRange.start, yRange.end);

  const clamp = (n: number | null | undefined) => (n == null ? null : Math.max(1, Math.min(5, Math.round(n))));
  const data = {
    skipped: skip,
    productivity: skip ? null : clamp(body.productivity),
    blocker: !skip && body.blocker && BLOCKERS.includes(body.blocker) ? body.blocker : null,
    blockerNote: !skip && body.blockerNote ? body.blockerNote.slice(0, 500) : null,
    focus: !skip && body.focus ? body.focus.slice(0, 500) : null,
    focusTaskIds: !skip && body.focusTaskIds?.length ? JSON.stringify(body.focusTaskIds.slice(0, 10)) : null,
    confidence: skip ? null : clamp(body.confidence),
    carryover: !skip && body.carryover?.length ? JSON.stringify(body.carryover.slice(0, 30)) : null,
    yesterdayActiveMinutes: measured.activeMinutes,
    yesterdayCompleted: measured.completed,
  };
  await prisma.dailyCheckin.upsert({
    where: { userId_localDate: { userId, localDate: today } },
    update: data,
    create: { userId, localDate: today, ...data },
  });
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function std(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function isoWeekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7; // Mon=0
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

/** Aggregate recent check-ins into the admin Pulse view. `userWhere` scopes the team. */
export async function buildCheckinInsights(userWhere: Record<string, unknown>, days = 28): Promise<PulseInsights> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const users = await prisma.user.findMany({
    where: { deletedAt: null, ...userWhere },
    select: { id: true, githubLogin: true, name: true, avatarUrl: true },
  });
  const userIds = users.map((u) => u.id);
  const checkins = userIds.length
    ? await prisma.dailyCheckin.findMany({
        where: { userId: { in: userIds }, skipped: false, createdAt: { gte: cutoff } },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  // Per-member rollups
  const byUser = new Map<string, typeof checkins>();
  for (const c of checkins) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);

  const baseMembers = users.map((u) => {
    const rows = byUser.get(u.id) ?? [];
    const prods = rows.map((r) => r.productivity).filter((n): n is number => n != null);
    const actives = rows.map((r) => r.yesterdayActiveMinutes ?? 0);
    const last = rows[rows.length - 1];
    return {
      user: u,
      responses: rows.length,
      avgProductivity: prods.length ? mean(prods) : null,
      avgActiveMinutes: actives.length ? mean(actives) : 0,
      lastBlocker: (last?.blocker as BlockerKey | null) ?? null,
      lastCheckinDate: last?.localDate ?? null,
    };
  });

  // felt-vs-measured gap = z(productivity) − z(activeMinutes) across responding members
  const responders = baseMembers.filter((m) => m.responses > 0 && m.avgProductivity != null);
  const pVals = responders.map((m) => m.avgProductivity!);
  const aVals = responders.map((m) => m.avgActiveMinutes);
  const pMean = mean(pVals);
  const aMean = mean(aVals);
  const pStd = std(pVals, pMean);
  const aStd = std(aVals, aMean);
  const members: PulseMember[] = baseMembers.map((m) => {
    let gap: number | null = null;
    if (m.responses > 0 && m.avgProductivity != null && pStd > 0 && aStd > 0) {
      const pZ = (m.avgProductivity - pMean) / pStd;
      const aZ = (m.avgActiveMinutes - aMean) / aStd;
      gap = Math.round((pZ - aZ) * 10) / 10;
    }
    return {
      userId: m.user.id,
      githubLogin: m.user.githubLogin,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      responses: m.responses,
      avgProductivity: m.avgProductivity != null ? Math.round(m.avgProductivity * 10) / 10 : null,
      avgActiveMinutes: Math.round(m.avgActiveMinutes),
      gap,
      lastBlocker: m.lastBlocker,
      lastCheckinDate: m.lastCheckinDate,
    };
  });

  // Sentiment trend by ISO week
  const weekMap = new Map<string, number[]>();
  for (const c of checkins) {
    if (c.productivity == null) continue;
    const wk = isoWeekStart(c.createdAt);
    weekMap.set(wk, [...(weekMap.get(wk) ?? []), c.productivity]);
  }
  const sentiment = [...weekMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, vals]) => ({ weekStart, avgProductivity: Math.round(mean(vals) * 10) / 10, responses: vals.length }));

  // Blocker tally (whole window)
  const blockerCount = new Map<BlockerKey, number>();
  for (const c of checkins) {
    if (!c.blocker) continue;
    blockerCount.set(c.blocker as BlockerKey, (blockerCount.get(c.blocker as BlockerKey) ?? 0) + 1);
  }
  const blockers = [...blockerCount.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  // Carry-over: current state from each member's latest check-in
  const carryover = { blocked: 0, dropping: 0, onTrack: 0 };
  for (const rows of byUser.values()) {
    const last = rows[rows.length - 1];
    if (!last?.carryover) continue;
    try {
      const items = JSON.parse(last.carryover) as CarryoverItem[];
      for (const it of items) {
        if (it.status === 'blocked') carryover.blocked++;
        else if (it.status === 'dropping') carryover.dropping++;
        else carryover.onTrack++;
      }
    } catch {
      /* ignore */
    }
  }

  return { rangeDays: days, members, sentiment, blockers, carryover };
}
