/**
 * Login-reminder check. Runs hourly (SCHEDULED) and acts once a day at
 * LOGIN_CHECK_HOUR (in the gating admin's local time), every day except Friday:
 *
 *  - Any dev with no login in the last INACTIVE_REMIND_HOURS (default 24h,
 *    Fridays excluded from the gap) is emailed a reminder to log in, and the
 *    admins get a summary citing those individuals.
 *  - Any dev with no login for INACTIVE_URGENT_HOURS (default 48h, Fridays
 *    excluded) additionally triggers an URGENT alert to the admins and the
 *    external URGENT_NOTIFY_EMAILS (arman@arks.ae by default).
 *
 * "Login" = a GitHub sign-in (User.lastLoginAt) or any session activity — logging
 * time implies presence, so active loggers are never nagged. No-ops without SMTP.
 */
import { prisma } from '@cadence/db';
import { mailConfigured, sendMail } from '../email/mailer';
import {
  renderAdminInactivity,
  renderUrgentInactivity,
  renderUserReminder,
  type InactiveEntry,
} from '../email/reminders';
import { env } from '../env';
import { inactiveHoursExcludingFridays, isFriday, localHour, resolveTz } from '../lib/tz';

export interface LoginCheckResult {
  ran: boolean;
  skipped?: string;
  remindersSent: number;
  urgentCount: number;
  adminNotified: boolean;
}

/** Most recent "seen" instant: last login or last session start/stop. */
async function lastSeenAt(userId: string, lastLoginAt: Date | null): Promise<Date | null> {
  const [lastStarted, lastEnded] = await Promise.all([
    prisma.session.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    }),
    prisma.session.findFirst({
      where: { userId, deletedAt: null, endedAt: { not: null } },
      orderBy: { endedAt: 'desc' },
      select: { endedAt: true },
    }),
  ]);
  const candidates = [lastLoginAt, lastStarted?.startedAt ?? null, lastEnded?.endedAt ?? null].filter(
    (d): d is Date => d != null,
  );
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

export async function runLoginCheck(respectSchedule = false, now = new Date()): Promise<LoginCheckResult> {
  if (!mailConfigured()) return { ran: false, skipped: 'smtp_not_configured', remindersSent: 0, urgentCount: 0, adminNotified: false };

  const admins = await prisma.user.findMany({
    where: { role: 'admin', deletedAt: null },
    select: { email: true, timezone: true },
  });
  const gateTz = resolveTz(admins.find((a) => a.timezone)?.timezone ?? null);

  // Daily, at the target hour, never on Friday (the gating admin's local Friday).
  if (respectSchedule) {
    if (isFriday(now, gateTz)) return { ran: false, skipped: 'friday', remindersSent: 0, urgentCount: 0, adminNotified: false };
    if (localHour(now, gateTz) !== env.LOGIN_CHECK_HOUR) {
      return { ran: false, skipped: 'off_hour', remindersSent: 0, urgentCount: 0, adminNotified: false };
    }
  }

  const devs = await prisma.user.findMany({
    where: { role: 'dev', deletedAt: null },
    select: { id: true, githubLogin: true, name: true, email: true, timezone: true, lastLoginAt: true },
  });

  const remind: InactiveEntry[] = [];
  const urgent: InactiveEntry[] = [];
  let remindersSent = 0;

  for (const d of devs) {
    const tz = resolveTz(d.timezone);
    // Don't nag a dev on their own local Friday.
    if (respectSchedule && isFriday(now, tz)) continue;
    const seen = await lastSeenAt(d.id, d.lastLoginAt);
    if (!seen) continue; // never logged in and no sessions → no basis to judge

    const hours = inactiveHoursExcludingFridays(seen, now, tz);
    if (hours < env.INACTIVE_REMIND_HOURS) continue;

    const entry: InactiveEntry = { login: d.githubLogin, name: d.name, hours, emailed: false };
    // Email the dev a reminder (if we have an address).
    if (d.email) {
      try {
        await sendMail({ to: d.email, ...renderUserReminder({ login: d.githubLogin, name: d.name, hours }) });
        entry.emailed = true;
        remindersSent++;
      } catch {
        /* best-effort */
      }
    }
    remind.push(entry);
    if (hours >= env.INACTIVE_URGENT_HOURS) urgent.push(entry);
  }

  const adminEmails = admins.map((a) => a.email).filter((e): e is string => Boolean(e));
  let adminNotified = false;

  // 24h summary → admins.
  if (remind.length > 0 && adminEmails.length > 0) {
    try {
      await sendMail({ to: adminEmails, ...renderAdminInactivity(remind) });
      adminNotified = true;
    } catch {
      /* best-effort */
    }
  }

  // 48h URGENT → admins + external recipients.
  if (urgent.length > 0) {
    const to = [...new Set([...adminEmails, ...env.URGENT_NOTIFY_EMAILS])];
    if (to.length > 0) {
      try {
        await sendMail({ to, ...renderUrgentInactivity(urgent) });
      } catch {
        /* best-effort */
      }
    }
  }

  return { ran: true, remindersSent, urgentCount: urgent.length, adminNotified };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const result = await runLoginCheck(true);
  console.log(JSON.stringify({ job: 'login-check', ...result, ms: Date.now() - startedAt, at: new Date().toISOString() }));
}

if (require.main === module) {
  void main()
    .catch((err) => {
      console.error('login-check failed:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
