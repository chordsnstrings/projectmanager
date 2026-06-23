// Commit → task resolution (§6), in priority order:
//   1. branch link  2. keyword (#N / Closes #N / owner/repo#N)  3. session window
import type { Db } from '../sync/upsert';

/** Extract referenced issue/PR numbers from a commit message or PR body. */
export function extractIssueRefs(text: string | null | undefined): number[] {
  if (!text) return [];
  const refs = new Set<number>();
  // owner/repo#N, #N, "Closes #N", "fixes #N" — the leading owner/repo is optional.
  const re = /(?:[\w.-]+\/[\w.-]+)?#(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) refs.add(n);
  }
  return [...refs];
}

export interface CommitContext {
  repoId: string;
  branch: string | null;
  message: string | null;
  authorUserId: string | null;
  occurredAt: Date;
}

/**
 * Resolve the task a commit belongs to. Returns the taskId or null. The
 * session-window fallback needs zero developer discipline (§6).
 */
export async function resolveCommitTaskId(db: Db, c: CommitContext): Promise<string | null> {
  // 1) Branch link
  if (c.branch) {
    const t = await db.task.findFirst({
      where: { repoId: c.repoId, branch: c.branch, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    if (t) return t.id;
  }

  // 2) Keyword
  for (const num of extractIssueRefs(c.message)) {
    const t = await db.task.findFirst({
      where: { repoId: c.repoId, githubNumber: num, deletedAt: null },
    });
    if (t) return t.id;
  }

  // 3) Session window — a session (for this author) on a task in this repo whose
  //    window contains the commit time.
  if (c.authorUserId) {
    const s = await db.session.findFirst({
      where: {
        userId: c.authorUserId,
        deletedAt: null,
        taskId: { not: null },
        startedAt: { lte: c.occurredAt },
        OR: [{ endedAt: null }, { endedAt: { gte: c.occurredAt } }],
        task: { repoId: c.repoId },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (s?.taskId) return s.taskId;
  }

  return null;
}
