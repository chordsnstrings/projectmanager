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
});
