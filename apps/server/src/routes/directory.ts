import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { MemberLite, RepoLite, TeamDTO } from '@cadence/shared';
import { requireAdmin, requireUser } from '../auth/require';

/** Reference lists for the assignment UI: team roster + connected repos. */
export async function directoryRoutes(app: FastifyInstance): Promise<void> {
  // Teams for the onboarding picker / admin switcher (any signed-in user).
  app.get('/teams', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const rows = await prisma.team.findMany({
      where: { deletedAt: null },
      select: { id: true, key: true, name: true },
      orderBy: { name: 'asc' },
    });
    return rows satisfies TeamDTO[];
  });

  // Team roster for assignee / collaborator pickers (admin).
  app.get('/users', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const rows = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, githubLogin: true, name: true, avatarUrl: true },
      orderBy: { githubLogin: 'asc' },
    });
    return rows satisfies MemberLite[];
  });

  // Connected repos for the "create branch" picker (any signed-in user).
  app.get('/repos', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const rows = await prisma.repo.findMany({
      where: { deletedAt: null },
      select: { id: true, fullName: true, defaultBranch: true },
      orderBy: { fullName: 'asc' },
    });
    return rows satisfies RepoLite[];
  });
}
