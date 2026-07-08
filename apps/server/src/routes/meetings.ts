import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { CreateMeetingBody, MeetingDTO, Paginated } from '@cadence/shared';
import { requireManager, requireUser } from '../auth/require';
import { meetingInclude, meetingRecipientIds, meetingToDTO } from '../services/meetings';
import { pushToUsers } from '../services/push';

const PAGE = 100;

export async function meetingRoutes(app: FastifyInstance): Promise<void> {
  // Schedule a meeting for specific people at a future time. Manager only:
  // owner may invite anyone; a lead only their own team.
  app.post<{ Body: CreateMeetingBody }>('/meetings', async (req, reply) => {
    const mgr = await requireManager(req, reply);
    if (!mgr) return;
    const b = req.body ?? ({} as CreateMeetingBody);
    const title = b.title?.trim();
    if (!title) return reply.code(400).send({ error: 'title_required' });
    const when = b.scheduledAt ? new Date(b.scheduledAt) : null;
    if (!when || Number.isNaN(when.getTime())) return reply.code(400).send({ error: 'invalid_time' });
    if (when.getTime() < Date.now()) return reply.code(400).send({ error: 'time_must_be_future' });
    const duration = Math.max(5, Math.min(600, Math.round(b.durationMinutes ?? 30)));
    const attendeeIds = [...new Set(b.attendeeIds ?? [])].filter(Boolean);
    if (attendeeIds.length === 0) return reply.code(400).send({ error: 'attendees_required' });

    // Attendees must exist. A lead can only invite their own team.
    const users = await prisma.user.findMany({ where: { id: { in: attendeeIds }, deletedAt: null }, select: { id: true, teamId: true } });
    if (users.length !== attendeeIds.length) return reply.code(400).send({ error: 'unknown_attendee' });
    if (mgr.role === 'lead' && users.some((u) => u.teamId !== mgr.teamId)) {
      return reply.code(403).send({ error: 'cross_team_attendee' });
    }

    const created = await prisma.meeting.create({
      data: {
        title: title.slice(0, 200),
        agenda: b.agenda?.trim() ? b.agenda.trim().slice(0, 4000) : null,
        location: b.location?.trim() ? b.location.trim().slice(0, 300) : null,
        scheduledAt: when,
        durationMinutes: duration,
        teamId: mgr.teamId,
        createdByUserId: mgr.id,
        attendees: { create: attendeeIds.map((userId) => ({ userId })) },
      },
      include: meetingInclude,
    });
    req.log.info({ audit: 'meeting.created', meetingId: created.id, by: mgr.id, at: when.toISOString(), n: attendeeIds.length }, 'audit');
    // Notify attendees (not the organizer) that they've been invited.
    const whenLabel = when.toISOString();
    void pushToUsers(
      attendeeIds.filter((id) => id !== mgr.id),
      { title: `Meeting scheduled: ${title}`, body: whenLabel, url: '/board', tag: `meeting-invite-${created.id}` },
    );
    return reply.code(201).send(meetingToDTO(created));
  });

  // Manager list of meetings to manage (owner: all; lead: own team or created).
  app.get<{ Querystring: { scope?: string } }>('/meetings', async (req, reply) => {
    const mgr = await requireManager(req, reply);
    if (!mgr) return;
    const upcomingOnly = req.query.scope !== 'all';
    const where: Record<string, unknown> = {};
    if (mgr.role === 'lead') where.OR = [{ teamId: mgr.teamId }, { createdByUserId: mgr.id }];
    if (upcomingOnly) {
      where.canceledAt = null;
      where.scheduledAt = { gte: new Date(Date.now() - 60 * 60_000) }; // include just-started
    }
    const rows = await prisma.meeting.findMany({
      where,
      include: meetingInclude,
      orderBy: { scheduledAt: upcomingOnly ? 'asc' : 'desc' },
      take: PAGE,
    });
    const body: Paginated<MeetingDTO> = { items: rows.map(meetingToDTO), nextCursor: null };
    return body;
  });

  // The caller's own upcoming meetings (attendee or organizer) — for the board.
  app.get('/me/meetings', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const rows = await prisma.meeting.findMany({
      where: {
        canceledAt: null,
        scheduledAt: { gte: new Date(Date.now() - 60 * 60_000) },
        OR: [{ createdByUserId: user.id }, { attendees: { some: { userId: user.id } } }],
      },
      include: meetingInclude,
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    });
    return rows.map(meetingToDTO);
  });

  // Cancel a meeting (organizer, or admin, or lead of its team). Notifies invitees.
  app.delete<{ Params: { id: string } }>('/meetings/:id', async (req, reply) => {
    const mgr = await requireManager(req, reply);
    if (!mgr) return;
    const meeting = await prisma.meeting.findUnique({ where: { id: req.params.id }, include: meetingInclude });
    if (!meeting) return reply.code(404).send({ error: 'meeting_not_found' });
    const canManage =
      mgr.role === 'admin' ||
      meeting.createdByUserId === mgr.id ||
      (mgr.role === 'lead' && !!meeting.teamId && meeting.teamId === mgr.teamId);
    if (!canManage) return reply.code(403).send({ error: 'forbidden' });
    if (meeting.canceledAt) return { ok: true };
    await prisma.meeting.update({ where: { id: meeting.id }, data: { canceledAt: new Date() } });
    req.log.info({ audit: 'meeting.canceled', meetingId: meeting.id, by: mgr.id }, 'audit');
    void pushToUsers(
      meetingRecipientIds(meeting).filter((id) => id !== mgr.id),
      { title: `Meeting canceled: ${meeting.title}`, body: meeting.scheduledAt.toISOString(), url: '/board', tag: `meeting-cancel-${meeting.id}` },
    );
    return { ok: true };
  });
}
