// Momentum — a personal, non-competitive progress layer. Everything here is a
// pure read-model computed from existing data (sessions, tasks, questions,
// meeting-minutes, check-ins); there is no XP ledger and no stored state, so it
// can never drift and needs no migration. It is deliberately NOT team-ranked:
// it rewards real outcomes (shipped tasks, answered questions, filed minutes,
// consistent check-ins), not hours logged — which is what Cadence exists to keep
// honest.
import type { MomentumBadge, MomentumDTO } from '@cadence/shared';
import type { Db } from '../sync/upsert';
import { addDays, localDateString, localToday, resolveTz } from '../lib/tz';

// XP earned per real outcome. Kept modest and outcome-based on purpose.
const XP = { task: 50, question: 15, minutes: 20, checkin: 10 } as const;

/** Cost in XP to advance FROM level L to L+1 (gently increasing). */
function levelCost(level: number): number {
  return 100 + (level - 1) * 80; // 100, 180, 260, 340, …
}
/** Total XP required to reach the start of `level` (level 1 starts at 0). */
function xpForLevelStart(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += levelCost(l);
  return total;
}
function levelFromXp(xp: number): { level: number; intoLevel: number; forLevel: number; nextLevelXp: number } {
  let level = 1;
  while (xp >= xpForLevelStart(level + 1)) level++;
  const start = xpForLevelStart(level);
  const forLevel = levelCost(level);
  return { level, intoLevel: xp - start, forLevel, nextLevelXp: start + forLevel };
}

/** current = consecutive days ending today (or yesterday); best = longest run. */
function streaks(days: Set<string>, today: string): { current: number; best: number } {
  if (days.size === 0) return { current: 0, best: 0 };
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  let current = 0;
  let cursor: string | null = days.has(today) ? today : days.has(addDays(today, -1)) ? addDays(today, -1) : null;
  while (cursor && days.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, best };
}

function badge(id: string, label: string, description: string, progress: number, goal: number): MomentumBadge {
  return { id, label, description, earned: progress >= goal, progress: Math.min(progress, goal), goal };
}

export async function buildMomentum(db: Db, userId: string, timezone: string | null): Promise<MomentumDTO> {
  const tz = resolveTz(timezone);
  const today = localToday(tz);

  const [tasksCompleted, questionsAnswered, minutesFiled, checkinRows, sessions] = await Promise.all([
    db.task.count({ where: { assigneeUserId: userId, status: 'done', deletedAt: null } }),
    db.question.count({ where: { targetUserId: userId, status: 'answered' } }),
    db.meetingMinutes.count({ where: { session: { userId } } }),
    db.dailyCheckin.findMany({ where: { userId, skipped: false }, select: { localDate: true } }),
    db.session.findMany({ where: { userId, deletedAt: null }, select: { startedAt: true } }),
  ]);

  const checkins = checkinRows.length;

  const activeDays = new Set(sessions.map((s: { startedAt: Date }) => localDateString(s.startedAt, tz)));
  const checkinDays = new Set(checkinRows.map((c: { localDate: string }) => c.localDate));
  const sessionStreak = streaks(activeDays, today);
  const checkinStreak = streaks(checkinDays, today);

  const xp =
    tasksCompleted * XP.task +
    questionsAnswered * XP.question +
    minutesFiled * XP.minutes +
    checkins * XP.checkin;
  const lvl = levelFromXp(xp);

  const badges: MomentumBadge[] = [
    badge('first_ship', 'First ship', 'Complete your first task', tasksCompleted, 1),
    badge('closer_10', 'Closer', 'Complete 10 tasks', tasksCompleted, 10),
    badge('closer_50', 'Machine', 'Complete 50 tasks', tasksCompleted, 50),
    badge('streak_3', 'Warmed up', 'A 3-day activity streak', sessionStreak.best, 3),
    badge('streak_7', 'On a roll', 'A 7-day activity streak', sessionStreak.best, 7),
    badge('streak_30', 'Relentless', 'A 30-day activity streak', sessionStreak.best, 30),
    badge('checkin_7', 'Present', 'Check in 7 days in a row', checkinStreak.best, 7),
    badge('curious_10', 'Responsive', 'Answer 10 questions', questionsAnswered, 10),
    badge('scribe_5', 'Scribe', 'File minutes for 5 meetings', minutesFiled, 5),
  ];

  return {
    xp,
    level: lvl.level,
    xpIntoLevel: lvl.intoLevel,
    xpForLevel: lvl.forLevel,
    nextLevelXp: lvl.nextLevelXp,
    streakDays: sessionStreak.current,
    bestStreakDays: sessionStreak.best,
    checkinStreakDays: checkinStreak.current,
    totals: { tasksCompleted, questionsAnswered, minutesFiled, checkins },
    badges,
  };
}
