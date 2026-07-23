import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { FlagDTO, Paginated } from '@cadence/shared';
import { assertCanViewUser, requireManager, requireUser } from '../auth/require';
import { taskDisplayTitle, taskOrigin } from '../services/map';
import { pushToUser } from '../services/push';

/** Flag types that hang on a still-running session (stoppable in bulk). */
const LIVE_SESSION_FLAG_TYPES = ['open_no_activity', 'long_open_session'] as const;

const PAGE = 50;

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

type FlagRow = {
  id: string;
  type: FlagDTO['type'];
  userId: string;
  sessionId: string | null;
  taskId: string | null;
  detail: string;
  status: FlagDTO['status'];
  createdAt: Date;
};

function flagToDTO(f: FlagRow, userLogin: string | null, task: TaskCtx | null): FlagDTO {
  return {
    id: f.id,
    type: f.type,
    userId: f.userId,
    userLogin,
    sessionId: f.sessionId,
    taskId: f.taskId,
    taskTitle: task ? taskDisplayTitle(task) : null,
    taskOrigin: task ? taskOrigin(task) : null,
    repoFullName: task?.repo?.fullName ?? null,
    detail: f.detail,
    status: f.status,
    createdAt: f.createdAt.toISOString(),
  };
}

export async function flagRoutes(app: FastifyInstance): Promise<void> {
  // Resolve / dismiss / reopen a flag (owner any; lead own team). Advisory, never blocking.
  app.patch<{ Params: { id: string }; Body: { status?: 'open' | 'resolved' | 'dismissed' } }>(
    '/flags/:id',
    async (req, reply) => {
      const mgr = await requireManager(req, reply);
      if (!mgr) return;
      const status = req.body?.status;
      if (!status || !['open', 'resolved', 'dismissed'].includes(status)) {
        return reply.code(400).send({ error: 'invalid_status' });
      }
      const flag = await prisma.flag.findUnique({ where: { id: req.params.id } });
      if (!flag) return reply.code(404).send({ error: 'flag_not_found' });
      // A lead may only act on flags of users in their own team.
      if (!(await assertCanViewUser(mgr, flag.userId, reply))) return;
      const updated = await prisma.flag.update({
        where: { id: flag.id },
        data: { status, resolvedAt: status === 'open' ? null : new Date() },
      });
      req.log.info({ audit: 'flag.status', flagId: flag.id, status, by: mgr.id }, 'audit');
      const u = await prisma.user.findUnique({ where: { id: updated.userId }, select: { githubLogin: true } });
      const task = updated.taskId
        ? await prisma.task.findUnique({ where: { id: updated.taskId }, select: taskCtxSelect })
        : null;
      return flagToDTO(updated, u?.githubLogin ?? null, task);
    },
  );

  // POST /flags/bulk — act on every OPEN flag in the manager's scope at once.
  //  - resolve: mark them all resolved.
  //  - stop:    end the running session behind each live-timer flag (idle /
  //             long-open), then resolve that flag. Live meetings are skipped
  //             (their runner must file minutes) and reported back.
  //  - ask:     raise the same question, individually, on every flag that has a
  //             task/session anchor — each targeted at that flag's own user.
  // Owner acts across all teams; a lead only within their own.
  app.post<{ Body: { action?: 'resolve' | 'stop' | 'ask'; body?: string } }>(
    '/flags/bulk',
    async (req, reply) => {
      const mgr = await requireManager(req, reply);
      if (!mgr) return;
      const action = req.body?.action;
      if (!action || !['resolve', 'stop', 'ask'].includes(action)) {
        return reply.code(400).send({ error: 'invalid_action' });
      }
      const scopeWhere =
        mgr.role === 'admin' ? {} : { user: { teamId: mgr.teamId ?? '__no_team__' } };
      const flags = await prisma.flag.findMany({ where: { status: 'open', ...scopeWhere } });

      if (action === 'resolve') {
        const ids = flags.map((f) => f.id);
        await prisma.flag.updateMany({ where: { id: { in: ids } }, data: { status: 'resolved', resolvedAt: new Date() } });
        req.log.info({ audit: 'flag.bulk.resolve', count: ids.length, by: mgr.id }, 'audit');
        return { resolved: ids.length };
      }

      if (action === 'stop') {
        const live = flags.filter(
          (f) => f.sessionId && (LIVE_SESSION_FLAG_TYPES as readonly string[]).includes(f.type),
        );
        let stopped = 0;
        let skippedMeetings = 0;
        const resolvedFlagIds: string[] = [];
        for (const f of live) {
          const session = await prisma.session.findFirst({ where: { id: f.sessionId!, deletedAt: null } });
          if (!session || !session.isOpen) {
            resolvedFlagIds.push(f.id); // already stopped elsewhere → flag is stale
            continue;
          }
          if (session.offTaskLabel === 'meeting') {
            const hasMinutes = await prisma.meetingMinutes.findUnique({ where: { sessionId: session.id }, select: { id: true } });
            if (!hasMinutes) {
              skippedMeetings++;
              continue; // can't force-stop a meeting without its minutes
            }
          }
          await prisma.session.update({ where: { id: session.id }, data: { isOpen: false, endedAt: new Date() } });
          stopped++;
          resolvedFlagIds.push(f.id);
        }
        await prisma.flag.updateMany({ where: { id: { in: resolvedFlagIds } }, data: { status: 'resolved', resolvedAt: new Date() } });
        req.log.info({ audit: 'flag.bulk.stop', stopped, skippedMeetings, by: mgr.id }, 'audit');
        return { stopped, skippedMeetings, resolved: resolvedFlagIds.length };
      }

      // action === 'ask'
      const body = req.body?.body?.trim();
      if (!body) return reply.code(400).send({ error: 'body_required' });
      // Only flags with an anchor can carry a question (skip activity_no_session).
      const askable = flags.filter((f) => f.taskId || f.sessionId);
      let asked = 0;
      for (const f of askable) {
        const q = await prisma.question.create({
          data: {
            adminUserId: mgr.id,
            targetUserId: f.userId,
            taskId: f.taskId ?? null,
            sessionId: f.sessionId ?? null,
            body,
            blocksNext: true,
          },
        });
        asked++;
        void pushToUser(f.userId, {
          title: 'A question is blocking your next task',
          body: body.slice(0, 140),
          url: '/board',
          tag: `question-${q.id}`,
        });
      }
      req.log.info({ audit: 'flag.bulk.ask', asked, by: mgr.id }, 'audit');
      return { asked };
    },
  );

  // GET /flags — owner: all; lead: own team; member: own.
  app.get<{ Querystring: { cursor?: string; status?: string } }>('/flags', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const status = (req.query.status as 'open' | 'resolved' | 'dismissed') ?? 'open';
    const scopeWhere =
      user.role === 'admin'
        ? {}
        : user.role === 'lead'
          ? { user: { teamId: user.teamId ?? '__no_team__' } }
          : { userId: user.id };
    const rows = await prisma.flag.findMany({
      where: {
        status,
        ...scopeWhere,
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE + 1,
      ...(req.query.cursor ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, PAGE);
    const userIds = [...new Set(page.map((f) => f.userId))];
    const taskIds = [...new Set(page.map((f) => f.taskId).filter(Boolean) as string[])];
    const [users, tasks] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, githubLogin: true } }),
      taskIds.length
        ? prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, ...taskCtxSelect } })
        : Promise.resolve([]),
    ]);
    const loginById = new Map(users.map((u) => [u.id, u.githubLogin]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const items: FlagDTO[] = page.map((f) =>
      flagToDTO(f, loginById.get(f.userId) ?? null, f.taskId ? taskById.get(f.taskId) ?? null : null),
    );
    const nextCursor = rows.length > PAGE ? (rows[PAGE]?.id ?? null) : null;
    const body: Paginated<FlagDTO> = { items, nextCursor };
    return body;
  });
}
