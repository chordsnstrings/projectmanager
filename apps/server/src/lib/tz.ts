// Timezone helpers (no deps — built on Intl). Day boundaries, idle detection and
// digests are computed in each user's local time. A user with no stored tz falls
// back to DEFAULT_TZ (env, else UTC).
export const DEFAULT_TZ = process.env.DEFAULT_TZ || 'UTC';

/** Resolve a usable IANA tz, falling back to DEFAULT_TZ then UTC if invalid. */
export function resolveTz(tz: string | null | undefined): string {
  const candidate = tz || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

function wallParts(date: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const map: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(date)) map[p.type] = p.value;
  let h = Number(map.hour);
  if (h === 24) h = 0; // some locales render midnight as 24
  return { y: Number(map.year), mo: Number(map.month), d: Number(map.day), h, mi: Number(map.minute), s: Number(map.second) };
}

/** Offset (ms) such that localWallClock = utc + offset, at the given instant. */
function offsetMs(date: Date, tz: string): number {
  const p = wallParts(date, tz);
  const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUTC - date.getTime();
}

/** "YYYY-MM-DD" for the given instant in tz. */
export function localDateString(date: Date, tz: string): string {
  const p = wallParts(date, resolveTz(tz));
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Local hour (0–23) for the given instant in tz. */
export function localHour(date: Date, tz: string): number {
  return wallParts(date, resolveTz(tz)).h;
}

/** The UTC instant of local midnight starting the calendar date `YYYY-MM-DD` in tz. */
export function startOfLocalDay(dateStr: string, tz: string): Date {
  const z = resolveTz(tz);
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y!, (m! - 1), d!, 0, 0, 0);
  // Correct using the offset at the guessed instant (handles standard offsets; DST-safe enough at midnight).
  const off = offsetMs(new Date(guess), z);
  return new Date(guess - off);
}

/** Add `n` calendar days to a "YYYY-MM-DD" string. */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** [start, end) UTC instants spanning the local calendar day `dateStr` in tz (DST-correct via next-day boundary). */
export function localDayRange(dateStr: string, tz: string): { start: Date; end: Date } {
  const z = resolveTz(tz);
  return { start: startOfLocalDay(dateStr, z), end: startOfLocalDay(addDays(dateStr, 1), z) };
}

/** Today's local calendar date in tz. */
export function localToday(tz: string, now: Date = new Date()): string {
  return localDateString(now, resolveTz(tz));
}

/** Local day-of-week (0=Sun … 5=Fri … 6=Sat) for the instant in tz. */
export function localWeekday(date: Date, tz: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: resolveTz(tz), weekday: 'short' }).format(date);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name] ?? 0;
}

/** Is the instant a Friday in tz? */
export function isFriday(date: Date, tz: string): boolean {
  return localWeekday(date, tz) === 5;
}

/**
 * Hours elapsed between `from` and `to`, NOT counting any Friday (a non-working
 * day): each whole local Friday calendar date strictly within the span subtracts
 * 24h. So "no login for 48h excluding Friday" is honored across a weekend.
 */
export function inactiveHoursExcludingFridays(from: Date, to: Date, tz: string): number {
  const z = resolveTz(tz);
  const rawHours = (to.getTime() - from.getTime()) / 3_600_000;
  if (rawHours <= 0) return 0;
  // Discount each whole local Friday in (fromDate, toDate] by 24h. Use a midday
  // instant per date to read the weekday safely across DST.
  let fridays = 0;
  let cursor = addDays(localDateString(from, z), 1);
  const lastDate = localDateString(to, z);
  for (let i = 0; i < 400 && cursor <= lastDate; i++) {
    const midday = new Date(startOfLocalDay(cursor, z).getTime() + 12 * 3_600_000);
    if (localWeekday(midday, z) === 5) fridays++;
    cursor = addDays(cursor, 1);
  }
  return Math.max(0, rawHours - fridays * 24);
}
