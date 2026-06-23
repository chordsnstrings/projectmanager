import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { TaskStatus } from '@cadence/db';
import type { Paginated, TaskDTO } from '@cadence/shared';
import { requireUser } from '../auth/require';
import { taskToDTO } from '../services/map';
import { decryptToken } from '../auth/tokenCrypto';
import { syncUserProjects } from '../github/userSync';

const PAGE = 50;

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // Re-sync the caller's projects from their stored OAuth token.
  app.post('/tasks/refresh', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { githubAccessToken: true, githubLogin: true },
    });
    const token = decryptToken(row?.githubAccessToken);
    if (!token) return reply.code(409).send({ error: 'no_github_token', detail: 'Sign in again to refresh.' });
    try {
      const result = await syncUserProjects(prisma, token, user.id, row!.githubLogin);
      return { synced: result.tasks, repos: result.repos };
    } catch (err) {
      req.log.warn({ err, userId: user.id }, 'refresh sync failed');
      return reply.code(502).send({ error: 'github_sync_failed' });
    }
  });

  app.get<{ Querystring: { status?: string; repo?: string; cursor?: string; userId?: string } }>(
    '/tasks',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;

      // Devs see their own tasks; admins may target a specific user via ?userId.
      const targetUserId =
        user.role === 'admin' && req.query.userId ? req.query.userId : user.id;

      const status = req.query.status as TaskStatus | undefined;
      const rows = await prisma.task.findMany({
        where: {
          deletedAt: null,
          assigneeUserId: targetUserId,
          ...(status ? { status } : {}),
          ...(req.query.repo ? { repo: { fullName: req.query.repo } } : {}),
        },
        include: {
          repo: { select: { fullName: true } },
          sessions: { where: { deletedAt: null }, select: { startedAt: true, endedAt: true } },
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: PAGE + 1,
        ...(req.query.cursor ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
      });

      const items = rows.slice(0, PAGE).map(taskToDTO);
      const nextCursor = rows.length > PAGE ? (rows[PAGE]?.id ?? null) : null;
      const body: Paginated<TaskDTO> = { items, nextCursor };
      return body;
    },
  );
}
