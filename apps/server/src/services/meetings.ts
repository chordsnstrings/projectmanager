// Scheduled meetings: mapping to DTOs + the pre-start reminder push (run from
// the SCHEDULED reconcile job, every 15 min).
import { prisma } from '@cadence/db';
import type { MeetingDTO } from '@cadence/shared';
import { pushToUsers } from './push';

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

/**
 * Push a reminder for meetings starting within the next ~20 minutes that haven't
 * been reminded yet. Idempotent via reminderSentAt. Returns the count reminded.
 */
export async function remindUpcomingMeetings(now = Date.now()): Promise<number> {
  const soon = new Date(now + 20 * 60_000);
  const due = await prisma.meeting.findMany({
    where: { canceledAt: null, reminderSentAt: null, scheduledAt: { gt: new Date(now - 60_000), lte: soon } },
    include: meetingInclude,
  });
  for (const m of due) {
    const mins = Math.max(0, Math.round((m.scheduledAt.getTime() - now) / 60_000));
    await pushToUsers(meetingRecipientIds(m), {
      title: mins <= 1 ? `Meeting starting: ${m.title}` : `Meeting in ${mins} min: ${m.title}`,
      body: m.location ? `${m.location}` : m.agenda ? m.agenda.slice(0, 140) : 'Tap to open Cadence',
      url: '/board',
      tag: `meeting-${m.id}`,
    });
    await prisma.meeting.update({ where: { id: m.id }, data: { reminderSentAt: new Date() } });
  }
  return due.length;
}
