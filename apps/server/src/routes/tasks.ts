import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { TaskStatus } from '@cadence/db';
import type { ManagedTask, Paginated, TaskDTO } from '@cadence/shared';
import { requireAdmin, requireUser } from '../auth/require';
import { managedTaskToDTO, taskToDTO } from '../services/map';
import { decryptToken } from '../auth/tokenCrypto';
import { syncUserProjects } from '../github/userSync';
import { autoStopOnCommit } from '../engine/reconcileFlags';
import { createBranch, CreateBranchError, slugBranch } from '../github/createBranch';

const PAGE = 50;
const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

// Shared include for ManagedTask responses (repo + sessions + collaborators).
const managedInclude = {
  repo: { select: { fullName: true } },
  sessions: { where: { deletedAt: null }, select: { startedAt: true, endedAt: true } },
  members: {
    where: { deletedAt: null },
    include: { user: { select: { id: true, githubLogin: true, name: true, avatarUrl: true } } },
  },
} as const;

type ManagedRow = Parameters<typeof managedTaskToDTO>[0];

async function toManaged(task: ManagedRow & { assigneeUserId: string | null }): Promise<ManagedTask> {
  const assignee = task.assigneeUserId
    ? await prisma.user.findUnique({
        where: { id: task.assigneeUserId },
        select: { id: true, githubLogin: true, name: true, avatarUrl: true },
      })
    : null;
  return managedTaskToDTO(task, assignee);
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // Admin creates a manual (non-git) task and assigns it. Collaborators optional.
  app.post<{
    Body: {
      title?: string;
      assigneeUserId?: string;
      collaboratorIds?: string[];
      estimateMinutes?: number | null;
      status?: TaskStatus;
    };
  }>('/tasks', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const title = req.body?.title?.trim();
    if (!title) return reply.code(400).send({ error: 'title_required' });
    const status = req.body?.status && STATUSES.includes(req.body.status) ? req.body.status : 'todo';
    const collaboratorIds = [...new Set(req.body?.collaboratorIds ?? [])].filter(
      (id) => id && id !== req.body?.assigneeUserId,
    );

    const created = await prisma.task.create({
      data: {
        source: 'manual',
        repoId: null,
        title: title.slice(0, 200),
        status,
        assigneeUserId: req.body?.assigneeUserId ?? null,
        createdByUserId: admin.id,
        estimateMinutes: req.body?.estimateMinutes ?? null,
        closedAt: status === 'done' ? new Date() : null,
        members: { create: collaboratorIds.map((userId) => ({ userId })) },
      },
      include: managedInclude,
    });
    req.log.info({ audit: 'task.created', taskId: created.id, by: admin.id }, 'audit');
    return toManaged(created);
  });

  // Admin: list all manual/assigned tasks across the team (Tasks tab).
  app.get<{ Querystring: { cursor?: string } }>('/tasks/managed', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const rows = await prisma.task.findMany({
      where: { deletedAt: null, source: 'manual' },
      include: managedInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(req.query.cursor ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
    });
    const slice = rows.slice(0, PAGE);
    // batch-load assignees
    const ids = [...new Set(slice.map((t) => t.assigneeUserId).filter(Boolean) as string[])];
    const users = ids.length
      ? await prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, githubLogin: true, name: true, avatarUrl: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const items: ManagedTask[] = slice.map((t) =>
      managedTaskToDTO(t, t.assigneeUserId ? byId.get(t.assigneeUserId) ?? null : null),
    );
    const nextCursor = rows.length > PAGE ? (rows[PAGE]?.id ?? null) : null;
    const body: Paginated<ManagedTask> = { items, nextCursor };
    return body;
  });

  // Update a task. Title (→ displayTitle) and status/estimate: admin or assignee.
  // Assignee + collaborators: admin only.
  app.patch<{
    Params: { id: string };
    Body: {
      title?: string | null;
      status?: TaskStatus;
      estimateMinutes?: number | null;
      assigneeUserId?: string | null;
      collaboratorIds?: string[];
    };
  }>('/tasks/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const task = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    const isAdmin = user.role === 'admin';
    if (!isAdmin && task.assigneeUserId !== user.id) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const data: Record<string, unknown> = {};
    const b = req.body ?? {};
    if (b.title !== undefined) {
      data.displayTitle = b.title && b.title.trim() ? b.title.trim().slice(0, 200) : null;
    }
    if (b.status !== undefined && STATUSES.includes(b.status)) {
      data.status = b.status;
      data.closedAt = b.status === 'done' ? task.closedAt ?? new Date() : null;
    }
    if (b.estimateMinutes !== undefined) data.estimateMinutes = b.estimateMinutes;
    if (isAdmin && b.assigneeUserId !== undefined) data.assigneeUserId = b.assigneeUserId;

    // Collaborators are admin-only and replace the existing set.
    if (isAdmin && b.collaboratorIds !== undefined) {
      const ids = [...new Set(b.collaboratorIds)].filter(
        (id) => id && id !== (b.assigneeUserId ?? task.assigneeUserId),
      );
      await prisma.$transaction([
        prisma.taskMember.deleteMany({ where: { taskId: task.id } }),
        ...(ids.length ? [prisma.taskMember.createMany({ data: ids.map((userId) => ({ taskId: task.id, userId })) })] : []),
      ]);
    }

    const updated = await prisma.task.update({ where: { id: task.id }, data, include: managedInclude });
    return toManaged(updated);
  });

  // "Create the git": make a branch in a connected repo and link it to the task.
  app.post<{ Params: { id: string }; Body: { repoId?: string; branch?: string } }>(
    '/tasks/:id/git',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      const task = await prisma.task.findFirst({
        where: { id: req.params.id, deletedAt: null },
        include: { members: { where: { deletedAt: null }, select: { userId: true } } },
      });
      if (!task) return reply.code(404).send({ error: 'task_not_found' });
      const allowed =
        user.role === 'admin' ||
        task.assigneeUserId === user.id ||
        task.members.some((m) => m.userId === user.id);
      if (!allowed) return reply.code(403).send({ error: 'forbidden' });

      const repoId = req.body?.repoId;
      if (!repoId) return reply.code(400).send({ error: 'repo_required' });
      const repo = await prisma.repo.findFirst({ where: { id: repoId, deletedAt: null } });
      if (!repo) return reply.code(404).send({ error: 'repo_not_found' });

      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { githubAccessToken: true },
      });
      const token = decryptToken(row?.githubAccessToken);
      if (!token) return reply.code(409).send({ error: 'no_github_token', detail: 'Sign in again to link git.' });

      const branch = req.body?.branch?.trim() || slugBranch(task.title, task.id);
      try {
        const result = await createBranch(token, repo.fullName, repo.defaultBranch, branch);
        const updated = await prisma.task.update({
          where: { id: task.id },
          data: { repoId: repo.id, branch: result.branch },
          include: managedInclude,
        });
        req.log.info({ audit: 'task.git', taskId: task.id, repo: repo.fullName, branch: result.branch, created: result.created, by: user.id }, 'audit');
        return toManaged(updated);
      } catch (err) {
        const code = err instanceof CreateBranchError ? err.code : 'create_branch_failed';
        req.log.warn({ err, taskId: task.id }, 'create branch failed');
        return reply.code(502).send({ error: code });
      }
    },
  );

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
      await autoStopOnCommit(prisma).catch(() => {});
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

      // Devs see tasks they own or collaborate on; admins may target a user via ?userId.
      const targetUserId = user.role === 'admin' && req.query.userId ? req.query.userId : user.id;

      const status = req.query.status as TaskStatus | undefined;
      const rows = await prisma.task.findMany({
        where: {
          deletedAt: null,
          OR: [
            { assigneeUserId: targetUserId },
            { members: { some: { userId: targetUserId, deletedAt: null } } },
          ],
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
