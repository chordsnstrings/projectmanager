/**
 * Reconcile (SCHEDULED every 10 min, §10): recompute the time-based flags that
 * webhooks can't trigger (open_no_activity, long_open_session) and refresh
 * aggregates. The flag engine is implemented in P3; this entrypoint is wired now
 * so the DigitalOcean SCHEDULED job has a stable target.
 *
 * Usage: node apps/server/dist/scripts/reconcile.js
 */
import { prisma } from '@cadence/db';

async function main(): Promise<void> {
  const startedAt = Date.now();
  // P3 will compute flags here. For now, a liveness sweep that confirms DB access.
  const openSessions = await prisma.session.count({ where: { isOpen: true, deletedAt: null } });
  console.log(
    JSON.stringify({
      job: 'reconcile',
      openSessions,
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
