// Session interval math (§9b). active-elapsed = union of intervals; task-hours =
// sum (may exceed elapsed under concurrency; never add overlaps).

export interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms
}

/** Total minutes covered by the UNION of intervals (overlaps counted once). */
export function unionMinutes(intervals: Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return 0;

  let total = 0;
  let curStart = sorted[0]!.start;
  let curEnd = sorted[0]!.end;
  for (let i = 1; i < sorted.length; i++) {
    const iv = sorted[i]!;
    if (iv.start <= curEnd) {
      curEnd = Math.max(curEnd, iv.end);
    } else {
      total += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    }
  }
  total += curEnd - curStart;
  return Math.round(total / 60000);
}

/** Sum of all interval durations (overlaps double-counted). */
export function sumMinutes(intervals: Interval[]): number {
  let total = 0;
  for (const iv of intervals) {
    if (iv.end > iv.start) total += iv.end - iv.start;
  }
  return Math.round(total / 60000);
}

/** Do any two intervals overlap (i.e. was there concurrency)? */
export function hasConcurrency(intervals: Interval[]): boolean {
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) return true;
  }
  return false;
}
