/**
 * Promote a user to admin by GitHub login (or list current admins).
 *
 *   node apps/server/dist/scripts/seed-admin.js <githubLogin>
 *   node apps/server/dist/scripts/seed-admin.js --list
 *
 * Note: the user must have signed in at least once (so the row exists). For
 * zero-touch bootstrap, set ADMIN_GITHUB_LOGINS instead — matching logins are
 * promoted automatically on sign-in.
 */
import { prisma } from '@cadence/db';

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg || arg === '--list') {
    const admins = await prisma.user.findMany({ where: { role: 'admin', deletedAt: null } });
    console.log(`admins (${admins.length}):`);
    for (const a of admins) console.log(`  - ${a.githubLogin} (${a.id})`);
    return;
  }
  const login = arg;
  const user = await prisma.user.findFirst({ where: { githubLogin: login, deletedAt: null } });
  if (!user) {
    console.error(
      `No user with login "${login}". They must sign in once first, ` +
        `or add "${login}" to ADMIN_GITHUB_LOGINS for auto-promotion on sign-in.`,
    );
    process.exitCode = 1;
    return;
  }
  const updated = await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } });
  console.log(`promoted ${updated.githubLogin} (${updated.id}) to admin.`);
}

void main()
  .catch((err) => {
    console.error('seed-admin failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
