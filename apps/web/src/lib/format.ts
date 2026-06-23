// Shared formatting helpers for the Cadence UI (§9).
// All output is intended to be rendered in `font-mono`.

/** "1h 12m", "45m", "0m". Rounds to whole minutes. */
export function fmtDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * ISO → "HH:MM" (24h, zero-padded). When `tz` (IANA) is given the time is shown
 * in that zone, so an admin sees a dev's day in the dev's own local time rather
 * than the admin's browser time.
 */
export function fmtClock(iso: string, tz?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  if (tz) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
    } catch {
      /* fall through to browser-local */
    }
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Live elapsed since `startIso`, formatted as a ticking clock.
 * "mm:ss" under an hour, "h:mm:ss" once past it.
 */
export function liveElapsed(startIso: string, now: number = Date.now()): string {
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return '00:00';
  const totalSec = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/** Compact relative time: "just now", "3m ago", "2h ago", "4d ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffSec = Math.round((now - t) / 1000);
  if (diffSec < 0) return 'just now';
  if (diffSec < 45) return 'just now';
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
