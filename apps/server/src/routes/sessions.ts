import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type {
  ActivityOverrideBody,
  DraftSummary,
  NudgeDTO,
  SessionDTO,
  StartSessionBody,
  StopSessionBody,
} from '@cadence/shared';
import { requireUser } from '../auth/require';
import { sessionToDTO } from '../services/map';
import { decryptToken } from '../auth/tokenCrypto';
import { syncRunningSessionCommits } from '../github/userSync';
import { autoStopOnCommit } from '../engine/reconcileFlags';
import { extractIssueRefs } from '../engine/attribution';
import { dominantActivity, inferActivityFromMessage } from '../engine/activity';
import { hasOpenBlockingQuestion } from '../services/questionGate';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // ── Start ──────────────────────────────────────────────────────────────────
  app.post<{ Body: StartSessionBody }>('/sessions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { taskId, offTaskLabel, intent, startedAt: startStr, endedAt: endStr } = req.body ?? {};
    if (!taskId && !offTaskLabel) {
      return reply.code(400).send({ error: 'taskId_or_offTaskLabel_required' });
    }
    if (taskId) {
      const task = await prisma.task.findFirst({
        where: { id: taskId, deletedAt: null },
        include: { members: { where: { deletedAt: null }, select: { userId: true } } },
      });
      if (!task) return reply.code(404).send({ error: 'task_not_found' });
      // Manual tasks are private to their assignee + collaborators (git tasks stay open).
      if (
        task.source === 'manual' &&
        user.role !== 'admin' &&
        task.assigneeUserId !== user.id &&
        !task.members.some((m) => m.userId === user.id)
      ) {
        return reply.code(403).send({ error: 'not_a_member' });
      }
    }

    // Backfill path: a completed session with explicit start/end — same day only.
    let startedAt = new Date();
    let endedAt: Date | null = null;
    let isOpen = true;
    if (startStr && endStr) {
      const s = new Date(startStr);
      const e = new Date(endStr);
      const now = new Date();
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
        return reply.code(400).send({ error: 'invalid_range' });
      }
      if (s < todayStart || e > now) {
        return reply.code(400).send({ error: 'backfill_today_only' });
      }
      startedAt = s;
      endedAt = e;
      isOpen = false;
    }

    // Dedupe: a live start for a task/off-task that already has an OPEN session
    // for this user returns the existing one instead of stacking a duplicate
    // timer (which would inflate task-hours). Backfills are exempt.
    if (isOpen) {
      const existing = await prisma.session.findFirst({
        where: {
          userId: user.id,
          isOpen: true,
          deletedAt: null,
          ...(taskId ? { taskId } : { taskId: null, offTaskLabel: offTaskLabel ?? null }),
        },
        include: { segments: true },
        orderBy: { startedAt: 'asc' },
      });
      if (existing) return reply.code(200).send(sessionToDTO(existing));
    }

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        taskId: taskId ?? null,
        offTaskLabel: offTaskLabel ?? null,
        intent: intent ?? null,
        startedAt,
        endedAt,
        isOpen,
      },
      include: { segments: true },
    });
    return reply.code(201).send(sessionToDTO(session));
  });

  // ── Stop ───────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: StopSessionBody }>(
    '/sessions/:id/stop',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      const session = await prisma.session.findFirst({
        where: { id: req.params.id, deletedAt: null },
      });
      if (!session) return reply.code(404).send({ error: 'session_not_found' });
      // Owner stops their own; an admin may stop anyone's (cleanup).
      if (session.userId !== user.id && user.role !== 'admin') {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const { summary, blocked, markTaskDone } = req.body ?? {};

      // Question gate (§6): a dev with an open blocking question cannot complete a task.
      if (markTaskDone && session.taskId) {
        if (await hasOpenBlockingQuestion(prisma, user.id)) {
          return reply.code(409).send({
            error: 'blocked_by_question',
            detail: 'Answer your open question before completing this task.',
          });
        }
      }

      const updated = await prisma.session.update({
        where: { id: session.id },
        data: {
          endedAt: new Date(),
          isOpen: false,
          summary: summary ?? session.summary,
          blocked: blocked ?? session.blocked,
        },
        include: { segments: true },
      });

      if (markTaskDone && session.taskId) {
        await prisma.task.update({
          where: { id: session.taskId },
          data: { status: 'done', closedAt: new Date() },
        });
      }

      return sessionToDTO(updated);
    },
  );

  // ── Edit a session's summary / blocked flag after the fact (owner or admin) ─
  app.patch<{ Params: { id: string }; Body: { summary?: string; blocked?: boolean } }>(
    '/sessions/:id',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      const session = await prisma.session.findFirst({
        where: { id: req.params.id, deletedAt: null },
        include: { segments: true },
      });
      if (!session) return reply.code(404).send({ error: 'session_not_found' });
      if (session.userId !== user.id && user.role !== 'admin') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const data: { summary?: string; blocked?: boolean } = {};
      if (typeof req.body?.summary === 'string') data.summary = req.body.summary;
      if (typeof req.body?.blocked === 'boolean') data.blocked = req.body.blocked;
      const updated = await prisma.session.update({
        where: { id: session.id },
        data,
        include: { segments: true },
      });
      return sessionToDTO(updated);
    },
  );

  // ── Live commit check: ingest commits for running task-sessions + auto-stop ─
  // Cheap (only running-session repos); the client polls this so "stop on commit"
  // works within ~30s without the GitHub App webhooks.
  app.post('/sessions/sync-commits', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { githubAccessToken: true, githubLogin: true, stopOnCommit: true },
    });
    const token = decryptToken(row?.githubAccessToken);
    let ingested = 0;
    let stopped = 0;
    if (token) {
      ingested = await syncRunningSessionCommits(prisma, token, user.id, row!.githubLogin).catch(() => 0);
      if (row?.stopOnCommit) stopped = await autoStopOnCommit(prisma).catch(() => 0);
    }
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, isOpen: true, deletedAt: null },
      include: { segments: true },
      orderBy: { startedAt: 'desc' },
    });
    return { ingested, stopped, active: sessions.map(sessionToDTO) };
  });

  // ── Active sessions (poll for live UI) ──────────────────────────────────────
  app.get('/sessions/active', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, isOpen: true, deletedAt: null },
      include: { segments: true },
      orderBy: { startedAt: 'desc' },
    });
    const body: SessionDTO[] = sessions.map(sessionToDTO);
    return body;
  });

  // ── Manual activity override (one tap) ─────────────────────────────────────
  app.post<{ Params: { id: string }; Body: ActivityOverrideBody }>(
    '/sessions/:id/activity',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      const session = await prisma.session.findFirst({
        where: { id: req.params.id, deletedAt: null },
      });
      if (!session) return reply.code(404).send({ error: 'session_not_found' });
      if (session.userId !== user.id) return reply.code(403).send({ error: 'forbidden' });
      const { type, startedAt, endedAt } = req.body ?? ({} as ActivityOverrideBody);
      if (!type || !startedAt || !endedAt) {
        return reply.code(400).send({ error: 'type_startedAt_endedAt_required' });
      }
      await prisma.activitySegment.create({
        data: {
          sessionId: session.id,
          type,
          source: 'manual',
          startedAt: new Date(startedAt),
          endedAt: new Date(endedAt),
        },
      });
      const fresh = await prisma.session.findUniqueOrThrow({
        where: { id: session.id },
        include: { segments: true },
      });
      return sessionToDTO(fresh);
    },
  );

  // ── Draft summary auto-drafted from commits in the session ─────────────────
  app.get<{ Params: { id: string } }>('/sessions/:id/draft-summary', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const session = await prisma.session.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { segments: true },
    });
    if (!session) return reply.code(404).send({ error: 'session_not_found' });
    if (session.userId !== user.id && user.role !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const end = session.endedAt ?? new Date();
    const commits = await prisma.gitEvent.findMany({
      where: {
        type: 'commit',
        occurredAt: { gte: session.startedAt, lte: end },
        ...(session.taskId ? { taskId: session.taskId } : { authorUserId: session.userId }),
      },
      orderBy: { occurredAt: 'asc' },
    });

    const durationMinutes = Math.max(
      0,
      Math.round((end.getTime() - session.startedAt.getTime()) / 60000),
    );

    // Activity split from manual/inferred segments, else inferred from commits.
    const split = new Map<string, number>();
    if (session.segments.length > 0) {
      for (const s of session.segments) {
        split.set(s.type, (split.get(s.type) ?? 0) + (s.endedAt.getTime() - s.startedAt.getTime()));
      }
    } else {
      for (const c of commits) {
        const t = inferActivityFromMessage(c.message);
        split.set(t, (split.get(t) ?? 0) + 1);
      }
    }
    const totalSplit = [...split.values()].reduce((a, b) => a + b, 0) || 1;
    const activitySplit = [...split.entries()].map(([type, v]) => ({
      type: type as DraftSummary['activitySplit'][number]['type'],
      fraction: v / totalSplit,
    }));

    const dominant =
      dominantActivity(
        commits.map((c) => ({ message: c.message, additions: c.additions, occurredAt: c.occurredAt.getTime() })),
      ) ?? 'coding';
    const splitStr = activitySplit
      .map((a) => `${a.type} ${Math.round(a.fraction * 100)}%`)
      .join(' / ');
    const detected =
      `${durationMinutes}m · ${commits.length} commit${commits.length === 1 ? '' : 's'}` +
      (splitStr ? ` · ${splitStr}` : ` · ${dominant}`);

    const firstSubject = commits[0]?.message?.split('\n')[0]?.trim();
    const summary = firstSubject ?? session.intent ?? 'Worked on the task.';
    const closesIssues = [...new Set(commits.flatMap((c) => extractIssueRefs(c.message)))];

    const body: DraftSummary = {
      detected,
      durationMinutes,
      commitCount: commits.length,
      activitySplit,
      summary,
      closesIssues,
    };
    return body;
  });

  // ── Nudges: "committing with no session" ───────────────────────────────────
  app.get('/nudges', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const since = new Date(Date.now() - 24 * 3600_000);
    const recent = await prisma.gitEvent.findMany({
      where: { type: 'commit', authorUserId: user.id, occurredAt: { gte: since } },
      include: { repo: { select: { fullName: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
    const nudges: NudgeDTO[] = [];
    for (const ev of recent) {
      const covering = await prisma.session.findFirst({
        where: {
          userId: user.id,
          deletedAt: null,
          startedAt: { lte: ev.occurredAt },
          OR: [{ endedAt: null }, { endedAt: { gte: ev.occurredAt } }],
        },
      });
      if (covering) continue;
      const suggested = ev.branch
        ? await prisma.task.findFirst({ where: { repoId: ev.repoId, branch: ev.branch, deletedAt: null } })
        : null;
      nudges.push({
        id: ev.id,
        kind: 'commit_no_session',
        repoFullName: ev.repo.fullName,
        branch: ev.branch,
        suggestedTaskId: suggested?.id ?? null,
        detail: `Commit ${ev.sha?.slice(0, 7) ?? ''} on ${ev.branch ?? 'a branch'} had no active session.`,
        occurredAt: ev.occurredAt.toISOString(),
      });
      if (nudges.length >= 5) break;
    }
    return nudges;
  });
}
