/**
 * Reconcile (SCHEDULED every 15 min, §10): recompute the time-based flags that
 * webhooks can't trigger (open_no_activity, long_open_session) and the overrun
 * flag, then persist them deduped.
 *
 * Usage: node apps/server/dist/scripts/reconcile.js
 */
import { prisma } from '@cadence/db';
import { autoStopOnCommit, generateInferredSegments, reconcileFlags } from '../engine/reconcileFlags';

async function main(): Promise<void> {
  const startedAt = Date.now();
  const stopped = await autoStopOnCommit(prisma);
  const segments = await generateInferredSegments(prisma);
  const result = await reconcileFlags(prisma);
  console.log(
    JSON.stringify({
      job: 'reconcile',
      ...result,
      autoStopped: stopped,
      segmentsCreated: segments,
      ms: Date.now() - startedAt,
      at: new Date().toISOString(),
    }),
  );
}

void main()
  .catch((err) => {
    console.error('reconcile failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
