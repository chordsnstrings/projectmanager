import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { FlagDTO, Paginated } from '@cadence/shared';
import { assertCanViewUser, requireManager, requireUser } from '../auth/require';

const PAGE = 50;

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
      const dto: FlagDTO = {
        id: updated.id,
        type: updated.type,
        userId: updated.userId,
        sessionId: updated.sessionId,
        taskId: updated.taskId,
        detail: updated.detail,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
      };
      return dto;
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
    const items: FlagDTO[] = rows.slice(0, PAGE).map((f) => ({
      id: f.id,
      type: f.type,
      userId: f.userId,
      sessionId: f.sessionId,
      taskId: f.taskId,
      detail: f.detail,
      status: f.status,
      createdAt: f.createdAt.toISOString(),
    }));
    const nextCursor = rows.length > PAGE ? (rows[PAGE]?.id ?? null) : null;
    const body: Paginated<FlagDTO> = { items, nextCursor };
    return body;
  });
}
