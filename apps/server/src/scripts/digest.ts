/**
 * Email digests (SCHEDULED daily, §10-adjacent). Sends:
 *  - one admin team digest (yesterday's rollup) to every admin with an email +
 *    any DIGEST_TO addresses, and
 *  - a per-dev "open items" nudge to each dev with open flags or open questions.
 *
 * No-ops cleanly when SMTP isn't configured. Usage:
 *   node apps/server/dist/scripts/digest.js
 */
import { prisma } from '@cadence/db';
import { mailConfigured, sendMail } from '../email/mailer';
import { buildTeamDashboard } from '../services/dashboard';
import { renderAdminDigest, renderDevDigest, type DevDigestData } from '../email/digest';
import { env } from '../env';

export interface DigestResult {
  adminRecipients: number;
  devsSent: number;
  skipped?: string;
}

/** Yesterday in UTC: [midnight-prev, midnight-today). */
function yesterdayRange(now = new Date()): { start: Date; end: Date; label: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 86_400_000);
  return { start, end, label: start.toISOString().slice(0, 10) };
}

/** Send the admin team digest. Returns the recipient count (0 if none/SMTP off). */
export async function sendAdminDigest(range = yesterdayRange()): Promise<number> {
  if (!mailConfigured()) return 0;
  const admins = await prisma.user.findMany({
    where: { role: 'admin', deletedAt: null, email: { not: null } },
    select: { email: true },
  });
  const recipients = new Set<string>();
  for (const a of admins) if (a.email) recipients.add(a.email);
  for (const e of env.DIGEST_TO) recipients.add(e);
  if (recipients.size === 0) return 0;

  const dash = await buildTeamDashboard(range.start, range.end);
  const [openFlags, openQuestions] = await Promise.all([
    prisma.flag.count({ where: { status: 'open' } }),
    prisma.question.count({ where: { status: 'open' } }),
  ]);
  const mail = renderAdminDigest(dash, { dateLabel: range.label, openFlags, openQuestions });
  await sendMail({ to: [...recipients], ...mail });
  return recipients.size;
}

/** Send per-dev nudges. Returns how many devs were emailed. */
export async function sendDevDigests(): Promise<number> {
  if (!mailConfigured()) return 0;
  const devs = await prisma.user.findMany({
    where: { role: 'dev', deletedAt: null, email: { not: null } },
    select: { id: true, email: true, name: true, githubLogin: true },
  });
  let sent = 0;
  for (const d of devs) {
    if (!d.email) continue;
    const [flags, questions] = await Promise.all([
      prisma.flag.findMany({
        where: { userId: d.id, status: 'open' },
        select: { type: true, detail: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.question.findMany({
        where: { targetUserId: d.id, status: 'open' },
        select: { body: true, blocksNext: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    const data: DevDigestData = {
      login: d.githubLogin,
      name: d.name,
      flags: flags.map((f) => ({ type: f.type, detail: f.detail })),
      questions: questions.map((q) => ({ body: q.body, blocksNext: q.blocksNext })),
    };
    const mail = renderDevDigest(data);
    if (!mail) continue;
    await sendMail({ to: d.email, ...mail });
    sent++;
  }
  return sent;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  if (!mailConfigured()) {
    console.log(JSON.stringify({ job: 'digest', skipped: 'smtp_not_configured' }));
    return;
  }
  const adminRecipients = await sendAdminDigest();
  const devsSent = await sendDevDigests();
  console.log(
    JSON.stringify({
      job: 'digest',
      adminRecipients,
      devsSent,
      ms: Date.now() - startedAt,
      at: new Date().toISOString(),
    }),
  );
}

// Only run when invoked directly (not when imported by the test route).
if (require.main === module) {
  void main()
    .catch((err) => {
      console.error('digest failed:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
