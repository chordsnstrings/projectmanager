import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { Role } from '@cadence/db';
import type { MemberLite, RepoLite, TeamDTO } from '@cadence/shared';
import { managerTeamWhere, requireAdmin, requireUser } from '../auth/require';

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

  // Roster for assignee / collaborator pickers. Members + leads see their own
  // team; owner sees all (optional ?team filter).
  app.get<{ Querystring: { team?: string } }>('/users', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const where =
      user.role === 'admin'
        ? await managerTeamWhere(user, req.query.team)
        : { teamId: user.teamId ?? '__no_team__' };
    const rows = await prisma.user.findMany({
      where: { deletedAt: null, ...where },
      select: { id: true, githubLogin: true, name: true, avatarUrl: true },
      orderBy: { githubLogin: 'asc' },
    });
    return rows satisfies MemberLite[];
  });

  // Promote/demote + reassign team (owner only). A lead = role 'lead' + a team.
  app.patch<{ Params: { id: string }; Body: { role?: Role; teamKey?: string } }>(
    '/users/:id',
    async (req, reply) => {
      const admin = await requireAdmin(req, reply);
      if (!admin) return;
      const data: { role?: Role; teamId?: string } = {};
      if (req.body?.role && ['admin', 'lead', 'dev'].includes(req.body.role)) data.role = req.body.role;
      if (req.body?.teamKey) {
        const team = await prisma.team.findFirst({ where: { key: req.body.teamKey, deletedAt: null } });
        if (!team) return reply.code(404).send({ error: 'team_not_found' });
        data.teamId = team.id;
      }
      if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'nothing_to_update' });
      const target = await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!target) return reply.code(404).send({ error: 'user_not_found' });
      const updated = await prisma.user.update({
        where: { id: target.id },
        data,
        select: { id: true, githubLogin: true, name: true, avatarUrl: true },
      });
      req.log.info({ audit: 'user.update', userId: target.id, by: admin.id, ...data }, 'audit');
      return updated satisfies MemberLite;
    },
  );

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
