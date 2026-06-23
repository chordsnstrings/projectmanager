// The question gate (§6): an open, blocking question prevents the target dev
// from completing their next task. A workflow gate, never a machine lockout.
import type { Db } from '../sync/upsert';

export async function hasOpenBlockingQuestion(db: Db, userId: string): Promise<boolean> {
  const q = await db.question.findFirst({
    where: { targetUserId: userId, status: 'open', blocksNext: true },
    select: { id: true },
  });
  return q !== null;
}
