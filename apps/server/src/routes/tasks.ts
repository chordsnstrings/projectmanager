import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { TaskStatus } from '@cadence/db';
import type { AuthUser } from '../auth/require';
import type { ManagedTask, Paginated, TaskCommentDTO, TaskDTO } from '@cadence/shared';
import { assertCanViewUser, managerTeamWhere, requireManager, requireUser } from '../auth/require';
import { managedTaskToDTO, taskToDTO } from '../services/map';
import { decryptToken } from '../auth/tokenCrypto';
import { syncUserProjects } from '../github/userSync';
import { autoStopOnCommit } from '../engine/reconcileFlags';
import { createBranch, CreateBranchError, slugBranch } from '../github/createBranch';
import { aiConfigured, AiError, assessTaskReadiness, generateTaskPlan, type Readiness } from '../ai/deepseek';
import { pushToUser, pushToUsers } from '../services/push';
import { createHash } from 'node:crypto';

const PAGE = 50;

function descHash(s: string | null | undefined): string {
  return createHash('sha1').update((s ?? '').trim()).digest('hex').slice(0, 16);
}
function parseArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

type ReadinessRow = {
  id: string;
  title: string;
  displayTitle: string | null;
  description: string | null;
  teamId: string | null;
  specReady: boolean | null;
  specScore: number | null;
  specMissing: string | null;
  specQuestions: string | null;
  specDescHash: string | null;
};

async function storeReadiness(taskId: string, v: Readiness, hash: string): Promise<void> {
  await prisma.task
    .update({
      where: { id: taskId },
      data: {
        specReady: v.ready,
        specScore: v.score,
        specMissing: JSON.stringify(v.missing),
        specQuestions: JSON.stringify(v.questions),
        specCheckedAt: new Date(),
        specDescHash: hash,
      },
    })
    .catch(() => {});
}

/**
 * Readiness verdict for a task, computing + caching when the cached verdict is
 * stale (description changed) or missing. Returns null when it can't be assessed
 * (no description-AI configured or the call failed) — callers then skip the gate.
 */
async function ensureReadiness(task: ReadinessRow, opts: { force?: boolean } = {}): Promise<Readiness | null> {
  const desc = task.description?.trim() ?? '';
  const hash = descHash(desc);
  if (!desc) {
    const v: Readiness = { ready: false, score: 0, missing: ['No description — add what needs doing.'], questions: [] };
    await storeReadiness(task.id, v, hash);
    return v;
  }
  if (!opts.force && task.specDescHash === hash && task.specReady !== null) {
    return { ready: task.specReady, score: task.specScore ?? 0, missing: parseArr(task.specMissing), questions: parseArr(task.specQuestions) };
  }
  if (!aiConfigured()) return null;
  try {
    const team = task.teamId ? await prisma.team.findUnique({ where: { id: task.teamId }, select: { key: true } }) : null;
    const v = await assessTaskReadiness({ title: task.displayTitle ?? task.title, description: desc, teamKey: team?.key ?? null });
    await storeReadiness(task.id, v, hash);
    return v;
  } catch {
    return null;
  }
}

// Who can see / comment on a task. Cadence is a team-clarity tool: a task's
// discussion is visible to (and joinable by) anyone on the task's team — not
// just the assignee/collaborators — so prior comments are seen by all. Admins
// (owners) see every team. `task.teamId` is set for manual tasks (where briefs
// + comments live); the assignee/collaborator/creator rules still cover the
// occasional git task whose team isn't materialised on the row.
function canAccessTask(
  user: AuthUser,
  task: { teamId: string | null; assigneeUserId: string | null; createdByUserId: string | null; members: { userId: string }[] },
): boolean {
  if (user.role === 'admin') return true;
  if (task.teamId && task.teamId === user.teamId) return true; // any teammate (incl. lead)
  if (task.assigneeUserId === user.id || task.createdByUserId === user.id) return true;
  return task.members.some((m) => m.userId === user.id);
}

// Manager of the task's team (admin, or lead of that team) or the task's creator
// — who may generate/edit/approve the plan.
function canManagePlan(
  user: AuthUser,
  task: { teamId: string | null; createdByUserId: string | null },
): boolean {
  return (
    user.role === 'admin' ||
    (user.role === 'lead' && !!task.teamId && task.teamId === user.teamId) ||
    task.createdByUserId === user.id
  );
}
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

function loadManaged(id: string) {
  return prisma.task.findUniqueOrThrow({ where: { id }, include: managedInclude });
}

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
  // Any member may create a manual task for their OWN team and self-assign or
  // leave it in the pool. Managers (admin/lead) may assign anyone in the team.
  app.post<{
    Body: {
      title?: string;
      description?: string | null;
      assigneeUserId?: string | null;
      collaboratorIds?: string[];
      estimateMinutes?: number | null;
      status?: TaskStatus;
    };
  }>('/tasks', async (req, reply) => {
    const actor = await requireUser(req, reply);
    if (!actor) return;
    if (!actor.teamId) return reply.code(409).send({ error: 'no_team', detail: 'Pick a team first.' });
    const title = req.body?.title?.trim();
    if (!title) return reply.code(400).send({ error: 'title_required' });
    const status = req.body?.status && STATUSES.includes(req.body.status) ? req.body.status : 'todo';
    const isManager = actor.role === 'admin' || actor.role === 'lead';

    // Members can only assign to themselves or leave unassigned.
    let assigneeUserId = req.body?.assigneeUserId ?? null;
    if (!isManager && assigneeUserId && assigneeUserId !== actor.id) {
      return reply.code(403).send({ error: 'members_self_assign_only' });
    }
    const collaboratorIds = [...new Set(req.body?.collaboratorIds ?? [])].filter(
      (id) => id && id !== assigneeUserId,
    );
    // Everyone on the task must be in the actor's team.
    const peopleIds = [...new Set([assigneeUserId, ...collaboratorIds].filter(Boolean) as string[])];
    if (peopleIds.length > 0) {
      const inTeam = await prisma.user.count({ where: { id: { in: peopleIds }, teamId: actor.teamId } });
      if (inTeam !== peopleIds.length) return reply.code(403).send({ error: 'cross_team_member' });
    }

    const created = await prisma.task.create({
      data: {
        source: 'manual',
        repoId: null,
        teamId: actor.teamId,
        title: title.slice(0, 200),
        description: req.body?.description?.trim() ? req.body.description.trim().slice(0, 4000) : null,
        status,
        assigneeUserId,
        createdByUserId: actor.id,
        estimateMinutes: req.body?.estimateMinutes ?? null,
        closedAt: status === 'done' ? new Date() : null,
        members: { create: collaboratorIds.map((userId) => ({ userId })) },
      },
      include: managedInclude,
    });
    req.log.info({ audit: 'task.created', taskId: created.id, by: actor.id, team: actor.teamId }, 'audit');
    // Notify the assignee (if it's someone else) and any collaborators.
    if (assigneeUserId && assigneeUserId !== actor.id) {
      void pushToUser(assigneeUserId, {
        title: 'You’ve been assigned a task',
        body: title.slice(0, 140),
        url: '/board',
        tag: `task-assigned-${created.id}`,
      });
    }
    void pushToUsers(
      collaboratorIds.filter((id) => id !== actor.id),
      { title: 'Added to a task', body: title.slice(0, 140), url: '/board', tag: `task-collab-${created.id}` },
    );
    return toManaged(created);
  });

  // Open pool: claimable unassigned manual tasks in the caller's team.
  app.get('/tasks/pool', async (req, reply) => {
    const actor = await requireUser(req, reply);
    if (!actor) return;
    if (!actor.teamId) return { items: [], nextCursor: null };
    const rows = await prisma.task.findMany({
      where: { deletedAt: null, source: 'manual', assigneeUserId: null, teamId: actor.teamId },
      include: { repo: { select: { fullName: true } }, sessions: { where: { deletedAt: null }, select: { startedAt: true, endedAt: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE,
    });
    const body: Paginated<TaskDTO> = { items: rows.map(taskToDTO), nextCursor: null };
    return body;
  });

  // Claim ("pick up") an unassigned team task.
  app.post<{ Params: { id: string }; Body: { override?: boolean } }>('/tasks/:id/claim', async (req, reply) => {
    const actor = await requireUser(req, reply);
    if (!actor) return;
    const task = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    if (task.teamId !== actor.teamId) return reply.code(403).send({ error: 'not_your_team' });
    if (task.assigneeUserId === actor.id) return toManaged(await loadManaged(task.id)); // no-op
    if (task.assigneeUserId) return reply.code(409).send({ error: 'already_claimed' });
    // Soft readiness gate: warn (don't hard-block) on an under-specified task.
    if (!req.body?.override) {
      const v = await ensureReadiness(task);
      if (v && !v.ready) return reply.code(409).send({ error: 'not_specified', readiness: v });
    } else {
      req.log.info({ audit: 'task.spec.override', taskId: task.id, at: 'claim', by: actor.id }, 'audit');
    }
    await prisma.task.update({ where: { id: task.id }, data: { assigneeUserId: actor.id } });
    req.log.info({ audit: 'task.claimed', taskId: task.id, by: actor.id }, 'audit');
    return toManaged(await loadManaged(task.id));
  });

  // Managers: list manual/assigned tasks (owner = all/optional ?team; lead = own team).
  app.get<{ Querystring: { cursor?: string; team?: string } }>('/tasks/managed', async (req, reply) => {
    const mgr = await requireManager(req, reply);
    if (!mgr) return;
    const teamWhere = await managerTeamWhere(mgr, req.query.team);
    const rows = await prisma.task.findMany({
      where: { deletedAt: null, source: 'manual', ...teamWhere },
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
      description?: string | null;
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
    // Manager of the task's team (admin any; lead own-team) may manage assignment;
    // the assignee may edit title/status/estimate.
    const isManager = user.role === 'admin' || (user.role === 'lead' && !!task.teamId && task.teamId === user.teamId);
    if (!isManager && task.assigneeUserId !== user.id) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const data: Record<string, unknown> = {};
    const b = req.body ?? {};
    if (b.title !== undefined) {
      data.displayTitle = b.title && b.title.trim() ? b.title.trim().slice(0, 200) : null;
    }
    if (b.description !== undefined) {
      data.description = b.description && b.description.trim() ? b.description.trim().slice(0, 4000) : null;
    }
    if (b.status !== undefined && STATUSES.includes(b.status)) {
      data.status = b.status;
      data.closedAt = b.status === 'done' ? task.closedAt ?? new Date() : null;
    }
    if (b.estimateMinutes !== undefined) data.estimateMinutes = b.estimateMinutes;
    if (isManager && b.assigneeUserId !== undefined) data.assigneeUserId = b.assigneeUserId;

    // Collaborators are manager-only and replace the existing set.
    if (isManager && b.collaboratorIds !== undefined) {
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

  // Archive (soft-delete) a task. A team manager (admin, or lead of the task's
  // team), the assignee, or the creator may archive. Note: a git-synced task
  // (issue/pr/branch) will reappear on the next GitHub sync — archive is durable
  // only for manual tasks.
  app.delete<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const task = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    const isManager = user.role === 'admin' || (user.role === 'lead' && !!task.teamId && task.teamId === user.teamId);
    if (!isManager && task.assigneeUserId !== user.id && task.createdByUserId !== user.id) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    await prisma.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
    req.log.info({ audit: 'task.archived', taskId: task.id, by: user.id }, 'audit');
    return { ok: true, id: task.id };
  });

  // Generate a step-by-step plan from the task's description via DeepSeek. Saves
  // it as an unapproved draft. Manager-of-team or creator only.
  app.post<{ Params: { id: string } }>('/tasks/:id/plan', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!aiConfigured()) return reply.code(503).send({ error: 'ai_not_configured' });
    const task = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    if (!canManagePlan(user, task)) return reply.code(403).send({ error: 'forbidden' });
    if (!task.description?.trim()) return reply.code(400).send({ error: 'description_required' });
    try {
      const plan = await generateTaskPlan({ title: task.displayTitle ?? task.title, description: task.description });
      const updated = await prisma.task.update({
        where: { id: task.id },
        data: { plan, planApproved: false, planApprovedById: null, planApprovedAt: null },
        include: managedInclude,
      });
      req.log.info({ audit: 'task.plan.generated', taskId: task.id, by: user.id }, 'audit');
      return toManaged(updated);
    } catch (err) {
      const code = err instanceof AiError ? err.code : 'ai_failed';
      req.log.warn({ err, taskId: task.id }, 'plan generation failed');
      return reply.code(502).send({ error: code });
    }
  });

  // Check whether the description is specified enough (AI). Manager/creator;
  // stores + returns the verdict. Used by the "check readiness" affordance.
  app.post<{ Params: { id: string } }>('/tasks/:id/readiness', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!aiConfigured()) return reply.code(503).send({ error: 'ai_not_configured' });
    const task = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    if (!canManagePlan(user, task)) return reply.code(403).send({ error: 'forbidden' });
    const desc = task.description?.trim() ?? '';
    if (!desc) {
      await ensureReadiness(task, { force: true });
      return toManaged(await loadManaged(task.id));
    }
    try {
      const team = task.teamId ? await prisma.team.findUnique({ where: { id: task.teamId }, select: { key: true } }) : null;
      const v = await assessTaskReadiness({ title: task.displayTitle ?? task.title, description: desc, teamKey: team?.key ?? null });
      await storeReadiness(task.id, v, descHash(desc));
      return toManaged(await loadManaged(task.id));
    } catch (err) {
      const code = err instanceof AiError ? err.code : 'ai_failed';
      req.log.warn({ err, taskId: task.id }, 'readiness check failed');
      return reply.code(502).send({ error: code });
    }
  });

  // Edit and/or approve the plan (manager-of-team or creator). Approval is the
  // gate that tells the assignee the steps are final.
  app.patch<{ Params: { id: string }; Body: { plan?: string | null; approved?: boolean; override?: boolean } }>(
    '/tasks/:id/plan',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      const task = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!task) return reply.code(404).send({ error: 'task_not_found' });
      if (!canManagePlan(user, task)) return reply.code(403).send({ error: 'forbidden' });
      // Soft readiness gate on approval (handoff): warn unless overridden.
      if (req.body?.approved === true) {
        if (!req.body?.override) {
          const v = await ensureReadiness(task);
          if (v && !v.ready) return reply.code(409).send({ error: 'not_specified', readiness: v });
        } else {
          req.log.info({ audit: 'task.spec.override', taskId: task.id, at: 'approve', by: user.id }, 'audit');
        }
      }
      const data: Record<string, unknown> = {};
      if (req.body?.plan !== undefined) {
        data.plan = req.body.plan && req.body.plan.trim() ? req.body.plan.slice(0, 8000) : null;
      }
      if (req.body?.approved !== undefined) {
        data.planApproved = !!req.body.approved;
        data.planApprovedById = req.body.approved ? user.id : null;
        data.planApprovedAt = req.body.approved ? new Date() : null;
      }
      const updated = await prisma.task.update({ where: { id: task.id }, data, include: managedInclude });
      req.log.info({ audit: 'task.plan.updated', taskId: task.id, by: user.id, approved: updated.planApproved }, 'audit');
      // Tell the assignee their steps are final (only on the transition to approved).
      if (req.body?.approved === true && updated.assigneeUserId && updated.assigneeUserId !== user.id) {
        void pushToUser(updated.assigneeUserId, {
          title: 'Your task steps are ready',
          body: (updated.displayTitle ?? updated.title).slice(0, 140),
          url: '/board',
          tag: `task-plan-${updated.id}`,
        });
      }
      return toManaged(updated);
    },
  );

  // Comments on a task (giver ↔ receiver). Anyone who can access the task.
  app.get<{ Params: { id: string } }>('/tasks/:id/comments', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { members: { where: { deletedAt: null }, select: { userId: true } } },
    });
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    if (!canAccessTask(user, task)) return reply.code(403).send({ error: 'forbidden' });
    const rows = await prisma.taskComment.findMany({
      where: { taskId: task.id, deletedAt: null },
      include: { user: { select: { githubLogin: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const items: TaskCommentDTO[] = rows.map((c) => ({
      id: c.id,
      taskId: c.taskId,
      userId: c.userId,
      authorLogin: c.user.githubLogin,
      authorAvatarUrl: c.user.avatarUrl,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    }));
    return items;
  });

  app.post<{ Params: { id: string }; Body: { body?: string } }>('/tasks/:id/comments', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { members: { where: { deletedAt: null }, select: { userId: true } } },
    });
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    if (!canAccessTask(user, task)) return reply.code(403).send({ error: 'forbidden' });
    const body = req.body?.body?.trim();
    if (!body) return reply.code(400).send({ error: 'body_required' });
    const c = await prisma.taskComment.create({
      data: { taskId: task.id, userId: user.id, body: body.slice(0, 4000) },
      include: { user: { select: { githubLogin: true, avatarUrl: true } } },
    });
    const dto: TaskCommentDTO = {
      id: c.id,
      taskId: c.taskId,
      userId: c.userId,
      authorLogin: c.user.githubLogin,
      authorAvatarUrl: c.user.avatarUrl,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    };
    // Notify the other people on the task (assignee, creator, collaborators).
    void pushToUsers(
      [task.assigneeUserId, task.createdByUserId, ...task.members.map((m) => m.userId)].filter((id) => id !== user.id),
      {
        title: `New comment from ${c.user.githubLogin}`,
        body: c.body.slice(0, 140),
        url: '/board',
        tag: `task-comment-${task.id}`,
      },
    );
    return reply.code(201).send(dto);
  });

  // Turn a meeting-minutes action item into a trackable manual task, in the
  // meeting runner's team (unassigned → the team pool). Idempotent: an item that
  // already has a task returns it. Manager of that team, or the runner, may act.
  app.post<{ Params: { itemId: string } }>('/meeting-items/:itemId/task', async (req, reply) => {
    const actor = await requireUser(req, reply);
    if (!actor) return;
    const item = await prisma.meetingMinutesItem.findUnique({
      where: { id: req.params.itemId },
      include: { minutes: { include: { session: { select: { userId: true, user: { select: { teamId: true } } } } } } },
    });
    if (!item) return reply.code(404).send({ error: 'item_not_found' });
    const runnerId = item.minutes.session.userId;
    const teamId = item.minutes.session.user.teamId;
    const isManager = actor.role === 'admin' || (actor.role === 'lead' && !!teamId && teamId === actor.teamId);
    if (!isManager && actor.id !== runnerId) return reply.code(403).send({ error: 'forbidden' });
    if (!teamId) return reply.code(409).send({ error: 'no_team' });

    // Already created → return the existing task (idempotent).
    if (item.taskId) {
      const existing = await prisma.task.findFirst({ where: { id: item.taskId, deletedAt: null }, include: managedInclude });
      if (existing) return toManaged(existing);
    }

    const descParts = [
      item.details && `Details: ${item.details}`,
      item.decision && `Decision: ${item.decision}`,
      item.responsible && `Responsible: ${item.responsible}`,
      item.timeline && `Timeline: ${item.timeline}`,
      item.remarks && item.remarks.toLowerCase() !== 'n/a' && `Remarks: ${item.remarks}`,
    ].filter(Boolean);

    const created = await prisma.task.create({
      data: {
        source: 'manual',
        repoId: null,
        teamId,
        title: item.topic.slice(0, 200),
        description: descParts.join('\n').slice(0, 4000) || null,
        status: 'todo',
        assigneeUserId: null,
        createdByUserId: actor.id,
      },
      include: managedInclude,
    });
    await prisma.meetingMinutesItem.update({ where: { id: item.id }, data: { taskId: created.id } });
    req.log.info({ audit: 'meeting.item.task', itemId: item.id, taskId: created.id, by: actor.id, team: teamId }, 'audit');
    return reply.code(201).send(await toManaged(created));
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

      // Members see tasks they own or collaborate on; managers may target a
      // viewable user via ?userId (owner: anyone; lead: own team).
      let targetUserId = user.id;
      if (req.query.userId && req.query.userId !== user.id) {
        if (!(await assertCanViewUser(user, req.query.userId, reply))) return;
        targetUserId = req.query.userId;
      }

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
