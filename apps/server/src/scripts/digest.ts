/**
 * Email digests. The job runs hourly (SCHEDULED) and delivers to each recipient
 * at DIGEST_HOUR in *their own* timezone:
 *  - an admin team digest (their local yesterday's rollup) to every admin with
 *    an email; plus any DIGEST_TO addresses (at DEFAULT_TZ), and
 *  - a per-dev "open items" nudge to each dev with open flags or open questions.
 *
 * On-demand sends (the admin "Send digest now" button) bypass the hour gate.
 * No-ops cleanly when SMTP isn't configured. Usage:
 *   node apps/server/dist/scripts/digest.js
 */
import { prisma } from '@cadence/db';
import { mailConfigured, sendMail } from '../email/mailer';
import { buildTeamDashboard } from '../services/dashboard';
import { renderAdminDigest, renderDevDigest, type DevDigestData } from '../email/digest';
import { env } from '../env';
import { DEFAULT_TZ, addDays, localHour, localToday, resolveTz, startOfLocalDay } from '../lib/tz';

const DIGEST_HOUR = Number(process.env.DIGEST_HOUR ?? 7); // local hour to deliver

/** Yesterday's [start, end) UTC instants for the local calendar, in tz. */
function yesterdayRange(tz: string, now = new Date()): { start: Date; end: Date; label: string } {
  const z = resolveTz(tz);
  const today = localToday(z, now);
  const label = addDays(today, -1);
  return { start: startOfLocalDay(label, z), end: startOfLocalDay(today, z), label };
}

/** Build + send one admin team digest (that recipient's local yesterday) to `to`. */
async function sendAdminDigestTo(to: string[], tz: string): Promise<void> {
  const range = yesterdayRange(tz);
  const dash = await buildTeamDashboard(range.start, range.end);
  const [openFlags, openQuestions] = await Promise.all([
    prisma.flag.count({ where: { status: 'open' } }),
    prisma.question.count({ where: { status: 'open' } }),
  ]);
  const mail = renderAdminDigest(dash, { dateLabel: range.label, openFlags, openQuestions });
  await sendMail({ to, ...mail });
}

/**
 * Send admin team digests. When `respectSchedule`, only recipients whose local
 * hour == DIGEST_HOUR get one; otherwise (on-demand) everyone does. Returns the
 * number of emails sent.
 */
export async function sendAdminDigest(respectSchedule = false, now = new Date()): Promise<number> {
  if (!mailConfigured()) return 0;
  const admins = await prisma.user.findMany({
    where: { role: 'admin', deletedAt: null, email: { not: null } },
    select: { email: true, timezone: true },
  });
  let sent = 0;
  for (const a of admins) {
    if (!a.email) continue;
    const tz = resolveTz(a.timezone);
    if (respectSchedule && localHour(now, tz) !== DIGEST_HOUR) continue;
    await sendAdminDigestTo([a.email], tz);
    sent++;
  }
  // Fixed DIGEST_TO addresses (no user/tz): deliver once, at DEFAULT_TZ.
  if (env.DIGEST_TO.length > 0 && (!respectSchedule || localHour(now, DEFAULT_TZ) === DIGEST_HOUR)) {
    await sendAdminDigestTo(env.DIGEST_TO, DEFAULT_TZ);
    sent++;
  }
  return sent;
}

/** Send per-dev nudges. Honors the local-hour gate when `respectSchedule`. */
export async function sendDevDigests(respectSchedule = false, now = new Date()): Promise<number> {
  if (!mailConfigured()) return 0;
  const devs = await prisma.user.findMany({
    where: { role: 'dev', deletedAt: null, email: { not: null } },
    select: { id: true, email: true, name: true, githubLogin: true, timezone: true },
  });
  let sent = 0;
  for (const d of devs) {
    if (!d.email) continue;
    if (respectSchedule && localHour(now, resolveTz(d.timezone)) !== DIGEST_HOUR) continue;
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
  const adminRecipients = await sendAdminDigest(true);
  const devsSent = await sendDevDigests(true);
  console.log(
    JSON.stringify({
      job: 'digest',
      digestHour: DIGEST_HOUR,
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
