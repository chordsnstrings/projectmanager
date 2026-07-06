import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { AnswerQuestionBody, QuestionDTO, RaiseQuestionBody } from '@cadence/shared';
import { assertCanViewUser, requireManager, requireUser } from '../auth/require';
import { taskDisplayTitle, taskOrigin } from '../services/map';
import { pushToUser } from '../services/push';

// Minimal task shape needed to label a question with its task context.
const taskCtxSelect = {
  displayTitle: true,
  title: true,
  source: true,
  githubNumber: true,
  branch: true,
  repo: { select: { fullName: true } },
} as const;
type TaskCtx = {
  displayTitle: string | null;
  title: string;
  source: 'issue' | 'pr' | 'branch' | 'manual';
  githubNumber: number | null;
  branch: string | null;
  repo: { fullName: string } | null;
};

/** Load task context for a set of questions, keyed by taskId. */
async function loadTaskCtx(taskIds: (string | null)[]): Promise<Map<string, TaskCtx>> {
  const ids = [...new Set(taskIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const tasks = await prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true, ...taskCtxSelect } });
  return new Map(tasks.map((t) => [t.id, t]));
}

/** Off-task label per session id — context for questions that have no task. */
async function loadSessionLabels(sessionIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(sessionIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const sessions = await prisma.session.findMany({ where: { id: { in: ids } }, select: { id: true, offTaskLabel: true } });
  return new Map(sessions.map((s) => [s.id, s.offTaskLabel ?? 'session']));
}

/** GitHub login per user id (for the "who must answer" chip). */
async function loadLogins(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, githubLogin: true } });
  return new Map(users.map((u) => [u.id, u.githubLogin]));
}

function toDTO(
  q: {
    id: string;
    adminUserId: string;
    targetUserId: string;
    taskId: string | null;
    sessionId: string | null;
    body: string;
    blocksNext: boolean;
    status: 'open' | 'answered';
    answer: string | null;
    createdAt: Date;
    answeredAt: Date | null;
  },
  task?: TaskCtx | null,
  targetLogin?: string | null,
  sessionLabel?: string | null,
): QuestionDTO {
  return {
    id: q.id,
    adminUserId: q.adminUserId,
    targetUserId: q.targetUserId,
    targetLogin: targetLogin ?? null,
    taskId: q.taskId,
    taskTitle: task ? taskDisplayTitle(task) : sessionLabel ?? null,
    taskOrigin: task ? taskOrigin(task) : sessionLabel ? 'session' : null,
    repoFullName: task?.repo?.fullName ?? null,
    sessionId: q.sessionId,
    body: q.body,
    blocksNext: q.blocksNext,
    status: q.status,
    answer: q.answer,
    createdAt: q.createdAt.toISOString(),
    answeredAt: q.answeredAt ? q.answeredAt.toISOString() : null,
  };
}

export async function questionRoutes(app: FastifyInstance): Promise<void> {
  // Manager raises a question on a session/task → gates the dev's next completion.
  // Owner may target anyone; a lead only users in their own team.
  app.post<{ Body: RaiseQuestionBody }>('/questions', async (req, reply) => {
    const mgr = await requireManager(req, reply);
    if (!mgr) return;
    const { targetUserId, taskId, sessionId, body, blocksNext } = req.body ?? ({} as RaiseQuestionBody);
    // A question needs the person + the text, and at least one anchor: a task
    // or a session (off-task work has no task, but is still askable).
    if (!targetUserId || !body || (!taskId && !sessionId)) {
      return reply.code(400).send({ error: 'targetUserId_body_and_task_or_session_required' });
    }
    if (!(await assertCanViewUser(mgr, targetUserId, reply))) return;
    const q = await prisma.question.create({
      data: {
        adminUserId: mgr.id,
        targetUserId,
        taskId: taskId ?? null,
        sessionId: sessionId ?? null,
        body,
        blocksNext: blocksNext ?? true,
      },
    });
    req.log.info(
      { audit: 'question.raised', questionId: q.id, by: mgr.id, target: targetUserId, taskId, blocksNext: q.blocksNext },
      'audit',
    );
    void pushToUser(targetUserId, {
      title: q.blocksNext ? 'A question is blocking your next task' : 'New question for you',
      body: body.slice(0, 140),
      url: '/board',
      tag: `question-${q.id}`,
    });
    return reply.code(201).send(
      toDTO(
        q,
        q.taskId ? (await loadTaskCtx([q.taskId])).get(q.taskId) : null,
        (await loadLogins([q.targetUserId])).get(q.targetUserId),
        q.sessionId ? (await loadSessionLabels([q.sessionId])).get(q.sessionId) : null,
      ),
    );
  });

  // Dev answers their question.
  app.post<{ Params: { id: string }; Body: AnswerQuestionBody }>(
    '/questions/:id/answer',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      const q = await prisma.question.findUnique({ where: { id: req.params.id } });
      if (!q) return reply.code(404).send({ error: 'question_not_found' });
      if (q.targetUserId !== user.id) return reply.code(403).send({ error: 'forbidden' });
      const answer = req.body?.answer?.trim();
      if (!answer) return reply.code(400).send({ error: 'answer_required' });
      const updated = await prisma.question.update({
        where: { id: q.id },
        data: { answer, status: 'answered', answeredAt: new Date() },
      });
      req.log.info({ audit: 'question.answered', questionId: q.id, by: user.id }, 'audit');
      return toDTO(
        updated,
        updated.taskId ? (await loadTaskCtx([updated.taskId])).get(updated.taskId) : null,
        (await loadLogins([updated.targetUserId])).get(updated.targetUserId),
        updated.sessionId ? (await loadSessionLabels([updated.sessionId])).get(updated.sessionId) : null,
      );
    },
  );

  // Queue: owner all; lead own team; member own.
  app.get<{ Querystring: { status?: string } }>('/questions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const status = req.query.status as 'open' | 'answered' | undefined;
    const scopeWhere =
      user.role === 'admin'
        ? {}
        : user.role === 'lead'
          ? { targetUser: { teamId: user.teamId ?? '__no_team__' } }
          : { targetUserId: user.id };
    const rows = await prisma.question.findMany({
      where: {
        ...(status ? { status } : {}),
        ...scopeWhere,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const [ctx, logins, sessionLabels] = await Promise.all([
      loadTaskCtx(rows.map((r) => r.taskId)),
      loadLogins(rows.map((r) => r.targetUserId)),
      loadSessionLabels(rows.filter((r) => !r.taskId).map((r) => r.sessionId)),
    ]);
    return rows.map((q) =>
      toDTO(
        q,
        q.taskId ? ctx.get(q.taskId) : null,
        logins.get(q.targetUserId),
        q.sessionId ? sessionLabels.get(q.sessionId) : null,
      ),
    );
  });
}
