import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { FlagDTO, Paginated } from '@cadence/shared';
import { requireUser } from '../auth/require';

const PAGE = 50;

export async function flagRoutes(app: FastifyInstance): Promise<void> {
  // GET /flags — admin: all open; dev: own open.
  app.get<{ Querystring: { cursor?: string; status?: string } }>('/flags', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const status = (req.query.status as 'open' | 'resolved' | 'dismissed') ?? 'open';
    const rows = await prisma.flag.findMany({
      where: {
        status,
        ...(user.role === 'admin' ? {} : { userId: user.id }),
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
