// Scheduled meetings: mapping to DTOs + the pre-start reminder push (run from
// the SCHEDULED reconcile job, every 15 min).
import { prisma } from '@cadence/db';
import type { MeetingDTO } from '@cadence/shared';
import { pushToUsers } from './push';
import { mailConfigured, sendMail } from '../email/mailer';
import { env } from '../env';

type MeetingRow = {
  id: string;
  title: string;
  agenda: string | null;
  location: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  teamId: string | null;
  createdByUserId: string;
  canceledAt: Date | null;
  createdBy?: { githubLogin: string } | null;
  attendees: { user: { id: string; githubLogin: string; name: string | null; avatarUrl: string | null } }[];
};

export const meetingInclude = {
  createdBy: { select: { githubLogin: true } },
  attendees: { include: { user: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } } } },
} as const;

export function meetingToDTO(m: MeetingRow): MeetingDTO {
  return {
    id: m.id,
    title: m.title,
    agenda: m.agenda,
    location: m.location,
    scheduledAt: m.scheduledAt.toISOString(),
    durationMinutes: m.durationMinutes,
    teamId: m.teamId,
    createdByUserId: m.createdByUserId,
    createdByLogin: m.createdBy?.githubLogin ?? null,
    canceled: m.canceledAt != null,
    attendees: m.attendees.map((a) => ({
      userId: a.user.id,
      githubLogin: a.user.githubLogin,
      name: a.user.name,
      avatarUrl: a.user.avatarUrl,
    })),
  };
}

/** Everyone who should hear about a meeting: its attendees + the organizer. */
export function meetingRecipientIds(m: { createdByUserId: string; attendees: { user: { id: string } }[] }): string[] {
  return [...new Set([m.createdByUserId, ...m.attendees.map((a) => a.user.id)])];
}

function fmtMeetingTime(d: Date): string {
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/** Reminder email for one meeting. */
function renderMeetingReminder(m: {
  title: string;
  scheduledAt: Date;
  durationMinutes: number;
  location: string | null;
  agenda: string | null;
  attendees: { user: { githubLogin: string } }[];
}, minutes: number): { subject: string; html: string; text: string } {
  const when = fmtMeetingTime(m.scheduledAt);
  const who = m.attendees.map((a) => a.user.githubLogin).join(', ');
  const lead = minutes <= 1 ? 'is starting now' : `starts in ${minutes} minutes`;
  const url = env.APP_BASE_URL || '';
  const rows = [
    ['When', `${when} · ${m.durationMinutes} min`],
    m.location ? ['Where', m.location] : null,
    who ? ['Attendees', who] : null,
    m.agenda ? ['Agenda', m.agenda] : null,
  ].filter(Boolean) as [string, string][];
  const html = `<div style="font-family:Arial,sans-serif;color:#111;max-width:520px">
    <h2 style="margin:0 0 4px;font-size:16px">${m.title}</h2>
    <p style="margin:0 0 14px;color:#555">This meeting ${lead}.</p>
    <table style="border-collapse:collapse;font-size:13px">
      ${rows.map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#777;vertical-align:top">${k}</td><td style="padding:3px 0">${v}</td></tr>`).join('')}
    </table>
    ${url ? `<p style="margin:16px 0 0"><a href="${url}" style="color:#8a6d3b">Open Cadence</a></p>` : ''}
  </div>`;
  const text = `${m.title}\nThis meeting ${lead}.\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${url ? `\n\n${url}` : ''}`;
  return { subject: `Reminder: ${m.title} ${lead}`, html, text };
}

/**
 * Remind attendees of meetings starting within the next ~20 minutes that haven't
 * been reminded yet — via push AND email (~15 min prior on the 15-min job).
 * Idempotent via reminderSentAt. Returns the count reminded.
 */
export async function remindUpcomingMeetings(now = Date.now()): Promise<number> {
  const soon = new Date(now + 20 * 60_000);
  const due = await prisma.meeting.findMany({
    where: { canceledAt: null, reminderSentAt: null, scheduledAt: { gt: new Date(now - 60_000), lte: soon } },
    include: {
      createdBy: { select: { githubLogin: true, email: true } },
      attendees: { include: { user: { select: { id: true, githubLogin: true, name: true, avatarUrl: true, email: true } } } },
    },
  });
  for (const m of due) {
    const mins = Math.max(0, Math.round((m.scheduledAt.getTime() - now) / 60_000));
    await pushToUsers(meetingRecipientIds(m), {
      title: mins <= 1 ? `Meeting starting: ${m.title}` : `Meeting in ${mins} min: ${m.title}`,
      body: m.location ? `${m.location}` : m.agenda ? m.agenda.slice(0, 140) : 'Tap to open Cadence',
      url: '/board',
      tag: `meeting-${m.id}`,
    });
    if (mailConfigured()) {
      const emails = [...new Set([m.createdBy?.email, ...m.attendees.map((a) => a.user.email)].filter((e): e is string => !!e && e.includes('@')))];
      if (emails.length) {
        const mail = renderMeetingReminder(m, mins);
        await sendMail({ to: emails, ...mail }).catch((err) => console.error('meeting reminder email failed:', err));
      }
    }
    await prisma.meeting.update({ where: { id: m.id }, data: { reminderSentAt: new Date() } });
  }
  return due.length;
}
