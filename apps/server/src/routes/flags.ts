import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { FlagDTO, Paginated } from '@cadence/shared';
import { assertCanViewUser, requireManager, requireUser } from '../auth/require';
import { taskDisplayTitle, taskOrigin } from '../services/map';

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
