// Activity-type inference (§6). Inferred from commit messages / git signal; a
// manual override segment wins for its span (handled at the segment layer).
import type { ActivityType } from '@cadence/db';

const DEBUG_RE = /\b(fix|bug|hotfix|patch)\b/i;
const CODE_RE = /\b(feat|add|implement|refactor|cleanup|rename|test)\b/i;

/** Classify a single commit message into an activity type. */
export function inferActivityFromMessage(message: string | null | undefined): ActivityType {
  if (!message) return 'coding';
  if (DEBUG_RE.test(message)) return 'debugging';
  if (CODE_RE.test(message)) return 'coding';
  return 'coding';
}

export interface CommitSignal {
  message: string | null;
  additions: number | null;
  occurredAt: number; // epoch ms
}

/**
 * Heuristic agent detection (§6): large additions in a short window with sparse
 * human edits. Refined later if editor/WakaTime signal is added.
 */
export function looksLikeAgent(c: CommitSignal): boolean {
  return (c.additions ?? 0) >= 400;
}

/**
 * Pick the dominant inferred activity for a session given its commits. A session
 * with no commits/edits reads as research.
 */
export function dominantActivity(commits: CommitSignal[]): ActivityType | null {
  if (commits.length === 0) return 'research';
  const tally = new Map<ActivityType, number>();
  for (const c of commits) {
    const t: ActivityType = looksLikeAgent(c) ? 'agent' : inferActivityFromMessage(c.message);
    tally.set(t, (tally.get(t) ?? 0) + 1);
  }
  let best: ActivityType | null = null;
  let bestN = -1;
  for (const [t, n] of tally) {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best;
}
