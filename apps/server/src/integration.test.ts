// Integration smoke against the local Postgres: signs a real session cookie and
// drives the session / dashboard / question-gate endpoints end to end.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
let adminId = '';
let devId = '';
let adminCookie = '';
let devCookie = '';
let available = true;

const uniq = () => Math.floor(Math.random() * 2_000_000_000) + 1;

beforeAll(async () => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/cadence?schema=public';
  process.env.SESSION_SECRET = 'itest-secret';
  process.env.CADENCE_API_TOKEN = 'itest-api-token';
  try {
    const db = await import('@cadence/db');
    prisma = db.prisma;
    await prisma.$queryRaw`select 1`;
    const { buildApp } = await import('./app');
    app = await buildApp();
    await app.ready();
    const admin = await prisma.user.create({
      data: { githubId: BigInt(uniq()), githubLogin: `admin_${uniq()}`, role: 'admin' },
    });
    const dev = await prisma.user.create({
      data: { githubId: BigInt(uniq()), githubLogin: `dev_${uniq()}`, role: 'dev' },
    });
    adminId = admin.id;
    devId = dev.id;
    // @ts-expect-error decorated by @fastify/cookie
    adminCookie = `cad_session=${app.signCookie(adminId)}`;
    // @ts-expect-error decorated by @fastify/cookie
    devCookie = `cad_session=${app.signCookie(devId)}`;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (!available) return;
  await prisma.question.deleteMany({ where: { targetUserId: devId } });
  await prisma.session.deleteMany({ where: { userId: { in: [adminId, devId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, devId] } } });
  await app.close();
  await prisma.$disconnect();
});

describe('authed API integration', () => {
  it('rejects anonymous /tasks', async () => {
    if (!available) return;
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('runs two concurrent off-task sessions and lists them', async () => {
    if (!available) return;
    const s1 = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: devCookie },
      payload: { offTaskLabel: 'research', intent: 'investigate' },
    });
    const s2 = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: devCookie },
      payload: { offTaskLabel: 'meeting' },
    });
    expect(s1.statusCode).toBe(201);
    expect(s2.statusCode).toBe(201);
    const active = await app.inject({
      method: 'GET',
      url: '/sessions/active',
      headers: { cookie: devCookie },
    });
    expect(active.statusCode).toBe(200);
    expect(active.json().length).toBeGreaterThanOrEqual(2);

    const stop = await app.inject({
      method: 'POST',
      url: `/sessions/${s1.json().id}/stop`,
      headers: { cookie: devCookie },
      payload: { summary: 'done researching' },
    });
    expect(stop.statusCode).toBe(200);
    expect(stop.json().isOpen).toBe(false);
  });

  it('admin sees team dashboard; dev is forbidden', async () => {
    if (!available) return;
    const ok = await app.inject({ method: 'GET', url: '/dashboard/team', headers: { cookie: adminCookie } });
    expect(ok.statusCode).toBe(200);
    expect(Array.isArray(ok.json().members)).toBe(true);
    const forbidden = await app.inject({ method: 'GET', url: '/dashboard/team', headers: { cookie: devCookie } });
    expect(forbidden.statusCode).toBe(403);
  });

  it('day timeline works for self', async () => {
    if (!available) return;
    const res = await app.inject({
      method: 'GET',
      url: `/dashboard/user/${devId}/day`,
      headers: { cookie: devCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe(devId);
    expect(Array.isArray(res.json().lanes)).toBe(true);
  });

  it('question gate blocks task completion until answered', async () => {
    if (!available) return;
    // seed a repo + task assigned to the dev
    const inst = await prisma.installation.create({
      data: { githubInstallationId: BigInt(uniq()), accountLogin: 'acme' },
    });
    const repo = await prisma.repo.create({
      data: { githubRepoId: BigInt(uniq()), fullName: 'acme/widget', installationId: inst.id },
    });
    const task = await prisma.task.create({
      data: { repoId: repo.id, source: 'issue', githubNumber: uniq(), title: 'do it', assigneeUserId: devId, status: 'in_progress' },
    });
    const session = await prisma.session.create({
      data: { userId: devId, taskId: task.id, startedAt: new Date(), isOpen: true },
    });
    // admin raises a blocking question
    const q = await app.inject({
      method: 'POST',
      url: '/questions',
      headers: { cookie: adminCookie },
      payload: { targetUserId: devId, taskId: task.id, sessionId: session.id, body: 'why so long?' },
    });
    expect(q.statusCode).toBe(201);

    // dev tries to stop + mark done → blocked
    const blocked = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/stop`,
      headers: { cookie: devCookie },
      payload: { markTaskDone: true },
    });
    expect(blocked.statusCode).toBe(409);

    // dev answers
    const ans = await app.inject({
      method: 'POST',
      url: `/questions/${q.json().id}/answer`,
      headers: { cookie: devCookie },
      payload: { answer: 'blocked on review' },
    });
    expect(ans.statusCode).toBe(200);

    // now completion succeeds
    const done = await app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/stop`,
      headers: { cookie: devCookie },
      payload: { markTaskDone: true },
    });
    expect(done.statusCode).toBe(200);

    // cleanup
    await prisma.session.deleteMany({ where: { taskId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
    await prisma.repo.delete({ where: { id: repo.id } });
    await prisma.installation.delete({ where: { id: inst.id } });
  });

  it('backfills a same-day off-task block; rejects out-of-day ranges', async () => {
    if (!available) return;
    const now = new Date();
    const start = new Date(now.getTime() - 60 * 60000).toISOString();
    const end = new Date(now.getTime() - 30 * 60000).toISOString();
    const ok = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: devCookie },
      payload: { offTaskLabel: 'meeting', startedAt: start, endedAt: end },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().isOpen).toBe(false);
    expect(ok.json().offTaskLabel).toBe('meeting');

    const yesterday = new Date(now.getTime() - 26 * 3600_000).toISOString();
    const bad = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { cookie: devCookie },
      payload: { offTaskLabel: 'meeting', startedAt: yesterday, endedAt: now.toISOString() },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('toggles stop-on-commit via /me/settings', async () => {
    if (!available) return;
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/settings',
      headers: { cookie: devCookie },
      payload: { stopOnCommit: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stopOnCommit).toBe(true);
    await app.inject({ method: 'PATCH', url: '/me/settings', headers: { cookie: devCookie }, payload: { stopOnCommit: false } });
  });

  it('admin resolves a flag; dev cannot', async () => {
    if (!available) return;
    const flag = await prisma.flag.create({
      data: { type: 'long_open_session', userId: devId, detail: 'test flag', status: 'open' },
    });
    const forbidden = await app.inject({
      method: 'PATCH',
      url: `/flags/${flag.id}`,
      headers: { cookie: devCookie },
      payload: { status: 'resolved' },
    });
    expect(forbidden.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'PATCH',
      url: `/flags/${flag.id}`,
      headers: { cookie: adminCookie },
      payload: { status: 'resolved' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('resolved');
    await prisma.flag.delete({ where: { id: flag.id } });
  });

  it('does not resurrect a resolved flag on the next reconcile', async () => {
    if (!available) return;
    const { persistFlagCandidate } = await import('./engine/reconcileFlags');
    const cand = {
      type: 'long_open_session' as const,
      userId: devId,
      sessionId: null,
      taskId: null,
      gitEventId: null,
      detail: 'resurrection test',
    };
    // first reconcile raises it
    expect(await persistFlagCandidate(prisma, cand)).toBe(true);
    const raised = await prisma.flag.findFirst({ where: { type: 'long_open_session', userId: devId, detail: 'resurrection test' } });
    expect(raised).toBeTruthy();

    // admin resolves it
    await prisma.flag.update({ where: { id: raised!.id }, data: { status: 'resolved', resolvedAt: new Date() } });

    // a later reconcile must NOT create a second one for the same object
    expect(await persistFlagCandidate(prisma, cand)).toBe(false);
    const count = await prisma.flag.count({ where: { type: 'long_open_session', userId: devId, detail: 'resurrection test' } });
    expect(count).toBe(1);

    await prisma.flag.deleteMany({ where: { type: 'long_open_session', userId: devId, detail: 'resurrection test' } });
  });

  it('activity-check requires the bearer token and reports per-user state', async () => {
    if (!available) return;
    const noAuth = await app.inject({ method: 'GET', url: '/api/integrations/activity' });
    expect(noAuth.statusCode).toBe(401);

    const badAuth = await app.inject({
      method: 'GET',
      url: '/api/integrations/activity',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(badAuth.statusCode).toBe(401);

    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/activity?windowMinutes=60',
      headers: { authorization: 'Bearer itest-api-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(String(body.signInUrl)).toMatch(/\/auth\/github$/);
    expect(typeof body.hasActivity).toBe('boolean');
    expect(Array.isArray(body.users)).toBe(true);
    expect(Array.isArray(body.inactive)).toBe(true);
    const devEntry = body.users.find((u: { userId: string }) => u.userId === devId);
    expect(devEntry).toBeTruthy();
    expect(typeof devEntry.startedInWindow).toBe('number');
    expect(typeof devEntry.hasOpenSession).toBe('boolean');
    expect(devEntry.timezone).toBeTruthy();
  });

  it('exposes productivity (self), progress (self/admin) and the completion log', async () => {
    if (!available) return;
    const prod = await app.inject({ method: 'GET', url: '/me/productivity', headers: { cookie: devCookie } });
    expect(prod.statusCode).toBe(200);
    const pb = prod.json();
    expect(pb.today).toBeTruthy();
    expect(pb.week).toBeTruthy();
    expect(typeof pb.today.activeMinutes).toBe('number');

    // dev sees own progress; admin may view the dev's
    const own = await app.inject({ method: 'GET', url: `/dashboard/user/${devId}/progress`, headers: { cookie: devCookie } });
    expect(own.statusCode).toBe(200);
    expect(Array.isArray(own.json().points)).toBe(true);
    expect(Array.isArray(own.json().milestones)).toBe(true);
    expect(Array.isArray(own.json().versions)).toBe(true);

    const asAdmin = await app.inject({ method: 'GET', url: `/dashboard/user/${devId}/progress`, headers: { cookie: adminCookie } });
    expect(asAdmin.statusCode).toBe(200);

    // a dev cannot view another user's progress
    const forbidden = await app.inject({ method: 'GET', url: `/dashboard/user/${adminId}/progress`, headers: { cookie: devCookie } });
    expect(forbidden.statusCode).toBe(403);

    const comp = await app.inject({ method: 'GET', url: '/completions', headers: { cookie: devCookie } });
    expect(comp.statusCode).toBe(200);
    expect(Array.isArray(comp.json().items)).toBe(true);
  });

  it('onboarding: a team-less user picks a team and it sticks', async () => {
    if (!available) return;
    // ensure teams exist
    const { seedTeams } = await import('./scripts/seed-teams');
    await seedTeams(prisma);

    const fresh = await prisma.user.create({
      data: { githubId: BigInt(uniq()), githubLogin: `new_${uniq()}`, role: 'dev', teamId: null },
    });
    // @ts-expect-error decorated by @fastify/cookie
    const cookie = `cad_session=${app.signCookie(fresh.id)}`;

    const me0 = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(me0.json().onboardingComplete).toBe(false);
    expect(me0.json().teamKey).toBeNull();

    const teams = await app.inject({ method: 'GET', url: '/teams', headers: { cookie } });
    expect(teams.statusCode).toBe(200);
    expect(teams.json().some((t: { key: string }) => t.key === 'marketing')).toBe(true);

    const bad = await app.inject({ method: 'PATCH', url: '/me/team', headers: { cookie }, payload: { teamKey: 'nope' } });
    expect(bad.statusCode).toBe(404);

    const set = await app.inject({ method: 'PATCH', url: '/me/team', headers: { cookie }, payload: { teamKey: 'marketing' } });
    expect(set.statusCode).toBe(200);
    expect(set.json().teamKey).toBe('marketing');
    expect(set.json().onboardingComplete).toBe(true);

    // one team per user — second set is rejected
    const again = await app.inject({ method: 'PATCH', url: '/me/team', headers: { cookie }, payload: { teamKey: 'programming' } });
    expect(again.statusCode).toBe(409);

    await prisma.user.delete({ where: { id: fresh.id } });
  });

  it('admin creates/assigns a manual task with collaborators; access is scoped', async () => {
    if (!available) return;
    const collab = await prisma.user.create({
      data: { githubId: BigInt(uniq()), githubLogin: `collab_${uniq()}`, role: 'dev' },
    });
    const outsider = await prisma.user.create({
      data: { githubId: BigInt(uniq()), githubLogin: `out_${uniq()}`, role: 'dev' },
    });
    // @ts-expect-error decorated by @fastify/cookie
    const collabCookie = `cad_session=${app.signCookie(collab.id)}`;
    // @ts-expect-error decorated by @fastify/cookie
    const outsiderCookie = `cad_session=${app.signCookie(outsider.id)}`;

    // a dev cannot create a task
    const forbidden = await app.inject({ method: 'POST', url: '/tasks', headers: { cookie: devCookie }, payload: { title: 'x' } });
    expect(forbidden.statusCode).toBe(403);

    // admin creates a manual task assigned to dev, with collab as collaborator
    const created = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { cookie: adminCookie },
      payload: { title: 'Ship onboarding', assigneeUserId: devId, collaboratorIds: [collab.id], estimateMinutes: 120 },
    });
    expect(created.statusCode).toBe(200);
    const task = created.json();
    expect(task.source).toBe('manual');
    expect(task.repoFullName).toBeNull();
    expect(task.assignee.id).toBe(devId);
    expect(task.members.map((m: { id: string }) => m.id)).toContain(collab.id);

    // shows up in the admin managed list
    const managed = await app.inject({ method: 'GET', url: '/tasks/managed', headers: { cookie: adminCookie } });
    expect(managed.statusCode).toBe(200);
    expect(managed.json().items.some((t: { id: string }) => t.id === task.id)).toBe(true);

    // collaborator sees it on their board and can start a session
    const collabTasks = await app.inject({ method: 'GET', url: '/tasks', headers: { cookie: collabCookie } });
    expect(collabTasks.json().items.some((t: { id: string }) => t.id === task.id)).toBe(true);
    const collabSession = await app.inject({ method: 'POST', url: '/sessions', headers: { cookie: collabCookie }, payload: { taskId: task.id } });
    expect(collabSession.statusCode).toBe(201);

    // an outsider cannot start a session on the private manual task
    const outsiderSession = await app.inject({ method: 'POST', url: '/sessions', headers: { cookie: outsiderCookie }, payload: { taskId: task.id } });
    expect(outsiderSession.statusCode).toBe(403);

    // admin updates status + clears collaborators
    const patched = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: { cookie: adminCookie },
      payload: { status: 'in_progress', collaboratorIds: [] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe('in_progress');
    expect(patched.json().members.length).toBe(0);

    // a non-assignee dev cannot patch the task
    const devPatch = await app.inject({ method: 'PATCH', url: `/tasks/${task.id}`, headers: { cookie: outsiderCookie }, payload: { status: 'done' } });
    expect(devPatch.statusCode).toBe(403);

    // directory: /users is team-scoped (any signed-in user); /repos open too
    expect((await app.inject({ method: 'GET', url: '/users', headers: { cookie: devCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/users', headers: { cookie: adminCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/repos', headers: { cookie: collabCookie } })).statusCode).toBe(200);

    // cleanup
    await prisma.session.deleteMany({ where: { taskId: task.id } });
    await prisma.taskMember.deleteMany({ where: { taskId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
    await prisma.user.deleteMany({ where: { id: { in: [collab.id, outsider.id] } } });
  });

  it('team scoping: leads see only their team; owner sees all + ?team filter', async () => {
    if (!available) return;
    const { seedTeams } = await import('./scripts/seed-teams');
    await seedTeams(prisma);
    const prog = await prisma.team.findUniqueOrThrow({ where: { key: 'programming' } });
    const mkt = await prisma.team.findUniqueOrThrow({ where: { key: 'marketing' } });
    const mk = (role: string, teamId: string, p: string) =>
      prisma.user.create({ data: { githubId: BigInt(uniq()), githubLogin: `${p}_${uniq()}`, role, teamId } });
    const leadA = await mk('lead', prog.id, 'leadA');
    const leadB = await mk('lead', mkt.id, 'leadB');
    const devA = await mk('dev', prog.id, 'devA');
    const devB = await mk('dev', mkt.id, 'devB');
    // @ts-expect-error signCookie decorated by @fastify/cookie
    const ck = (id: string) => `cad_session=${app.signCookie(id)}`;
    const memberIds = (r: { json: () => { members: { userId: string }[] } }) => r.json().members.map((m) => m.userId);

    // lead sees only their own team in the dashboard
    const teamA = await app.inject({ method: 'GET', url: '/dashboard/team', headers: { cookie: ck(leadA.id) } });
    expect(teamA.statusCode).toBe(200);
    expect(memberIds(teamA)).toContain(devA.id);
    expect(memberIds(teamA)).not.toContain(devB.id);

    // lead cannot view a user outside their team; can within
    expect((await app.inject({ method: 'GET', url: `/dashboard/user/${devB.id}/day`, headers: { cookie: ck(leadA.id) } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/dashboard/user/${devA.id}/day`, headers: { cookie: ck(leadA.id) } })).statusCode).toBe(200);

    // a member can't reach a manager dashboard
    expect((await app.inject({ method: 'GET', url: '/dashboard/team', headers: { cookie: ck(devA.id) } })).statusCode).toBe(403);

    // owner sees all, and ?team= filters
    const all = await app.inject({ method: 'GET', url: '/dashboard/team', headers: { cookie: adminCookie } });
    expect(memberIds(all)).toEqual(expect.arrayContaining([devA.id, devB.id]));
    const mktOnly = await app.inject({ method: 'GET', url: '/dashboard/team?team=marketing', headers: { cookie: adminCookie } });
    expect(memberIds(mktOnly)).toContain(devB.id);
    expect(memberIds(mktOnly)).not.toContain(devA.id);

    // PATCH /users/:id is owner-only and promotes a lead
    expect((await app.inject({ method: 'PATCH', url: `/users/${devA.id}`, headers: { cookie: ck(leadA.id) }, payload: { role: 'lead' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/users/${devB.id}`, headers: { cookie: adminCookie }, payload: { role: 'lead' } })).statusCode).toBe(200);

    // a lead can't raise a question against another team's user
    const q = await app.inject({ method: 'POST', url: '/questions', headers: { cookie: ck(leadB.id) }, payload: { targetUserId: devA.id, taskId: 'x', body: 'hi' } });
    expect(q.statusCode).toBe(403);

    await prisma.user.deleteMany({ where: { id: { in: [leadA.id, leadB.id, devA.id, devB.id] } } });
  });
});
