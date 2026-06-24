/**
 * Idempotent team seed + backfill. Runs automatically at server boot, and can
 * be run standalone:
 *
 *   node apps/server/dist/scripts/seed-teams.js
 *
 * - Upserts the built-in teams (programming, marketing).
 * - Moves every user with no team → programming (everyone today is a programmer;
 *   marketing is net-new), so nobody is stranded in onboarding post-migration.
 * - Moves every existing manual task with no team → programming.
 */
import { prisma, type PrismaClient } from '@cadence/db';

const TEAMS: { key: string; name: string }[] = [
  { key: 'programming', name: 'Programming' },
  { key: 'marketing', name: 'Marketing' },
];

export async function seedTeams(db: PrismaClient = prisma): Promise<{
  usersBackfilled: number;
  manualTasksBackfilled: number;
}> {
  let programmingId = '';
  for (const t of TEAMS) {
    const row = await db.team.upsert({
      where: { key: t.key },
      update: { name: t.name, deletedAt: null },
      create: { key: t.key, name: t.name },
    });
    if (t.key === 'programming') programmingId = row.id;
  }

  const users = await db.user.updateMany({ where: { teamId: null }, data: { teamId: programmingId } });
  const tasks = await db.task.updateMany({
    where: { source: 'manual', teamId: null },
    data: { teamId: programmingId },
  });
  return { usersBackfilled: users.count, manualTasksBackfilled: tasks.count };
}

// CLI entry (no-op when imported).
if (require.main === module) {
  void seedTeams()
    .then((r) => console.log(JSON.stringify({ job: 'seed-teams', ...r })))
    .catch((err) => {
      console.error('seed-teams failed:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
