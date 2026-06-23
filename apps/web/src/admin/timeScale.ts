// Helpers mapping wall-clock instants to a percentage across a day window (§9b).

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export function makeWindow(dayStart: string, dayEnd: string): TimeWindow {
  const startMs = new Date(dayStart).getTime();
  const endMs = new Date(dayEnd).getTime();
  // Guard against a degenerate window.
  return { startMs, endMs: endMs > startMs ? endMs : startMs + 1 };
}

/** ISO instant → percent (0..100) across the window, clamped. */
export function pct(iso: string, w: TimeWindow): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  const raw = ((t - w.startMs) / (w.endMs - w.startMs)) * 100;
  return Math.min(100, Math.max(0, raw));
}

/**
 * A bar's left/width as percentages. An open (running) session is treated as
 * ending at `nowMs` (defaults to now).
 */
export function barGeom(
  startIso: string,
  endIso: string | null,
  w: TimeWindow,
  nowMs: number = Date.now(),
): { left: number; width: number } {
  const left = pct(startIso, w);
  const endPct = endIso
    ? pct(endIso, w)
    : Math.min(100, Math.max(left, ((nowMs - w.startMs) / (w.endMs - w.startMs)) * 100));
  return { left, width: Math.max(0.4, endPct - left) };
}

/**
 * Hour tick marks (as percentages) for the axis. When `tz` is given, labels are
 * the hour in that zone (the window already spans that zone's local midnight),
 * so an admin reads a dev's day in the dev's local hours.
 */
export function hourTicks(w: TimeWindow, tz?: string): { label: string; left: number }[] {
  const ticks: { label: string; left: number }[] = [];
  const hourFmt =
    tz != null
      ? (() => {
          try {
            return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false });
          } catch {
            return null;
          }
        })()
      : null;
  const first = new Date(w.startMs);
  first.setMinutes(0, 0, 0);
  if (first.getTime() < w.startMs) first.setHours(first.getHours() + 1);
  for (let t = first.getTime(); t <= w.endMs; t += 3_600_000) {
    const d = new Date(t);
    const left = ((t - w.startMs) / (w.endMs - w.startMs)) * 100;
    const label = hourFmt
      ? hourFmt.formatToParts(d).find((p) => p.type === 'hour')?.value.padStart(2, '0') ??
        String(d.getHours()).padStart(2, '0')
      : String(d.getHours()).padStart(2, '0');
    ticks.push({ label, left });
  }
  return ticks;
}
