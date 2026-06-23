import { describe, expect, it, vi } from 'vitest';
import { routeWebhook } from './router';
import type { Db } from '../sync/upsert';

/** Build a fake Prisma surface that records task.create / appendGitEvent calls. */
function fakeDb() {
  const taskCreate = vi.fn(async (args: { data: unknown }) => ({ id: 'task1', ...args.data }));
  const gitEventCreate = vi.fn(async (args: { data: unknown }) => ({ id: 'ge1', ...args.data }));
  const db = {
    repo: { findUnique: vi.fn(async () => ({ id: 'repo1' })) },
    user: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
    userEmail: { findUnique: vi.fn(async () => null) },
    task: {
      findFirst: vi.fn(async () => null),
      create: taskCreate,
      update: vi.fn(async () => ({ id: 'task1' })),
    },
    gitEvent: { findUnique: vi.fn(async () => null), create: gitEventCreate },
    installation: { upsert: vi.fn(async () => ({ id: 'inst1' })) },
  } as unknown as Db;
  return { db, taskCreate, gitEventCreate };
}

describe('routeWebhook', () => {
  it('creates a task from an opened issue with an est label', async () => {
    const { db, taskCreate } = fakeDb();
    await routeWebhook(db, {
      event: 'issues',
      deliveryId: 'd1',
      payload: {
        action: 'opened',
        repository: { id: 555 },
        issue: { number: 42, title: 'Build the thing', state: 'open', labels: [{ name: 'est:2h' }] },
      },
    });
    expect(taskCreate).toHaveBeenCalledTimes(1);
    const data = taskCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({
      source: 'issue',
      githubNumber: 42,
      title: 'Build the thing',
      status: 'todo',
      estimateMinutes: 120,
    });
  });

  it('records a commit git-event per commit on push, keyed uniquely', async () => {
    const { db, gitEventCreate } = fakeDb();
    await routeWebhook(db, {
      event: 'push',
      deliveryId: 'd2',
      payload: {
        repository: { id: 555 },
        ref: 'refs/heads/feat/x',
        commits: [
          { id: 'sha1', message: 'feat: a', timestamp: '2026-06-23T00:00:00Z', added: ['a'] },
          { id: 'sha2', message: 'fix: b', timestamp: '2026-06-23T00:01:00Z', modified: ['b'] },
        ],
      },
    });
    expect(gitEventCreate).toHaveBeenCalledTimes(2);
    const first = gitEventCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(first).toMatchObject({ type: 'commit', sha: 'sha1', branch: 'feat/x', deliveryId: 'd2:sha1' });
  });

  it('ignores unknown events', async () => {
    const { db, taskCreate, gitEventCreate } = fakeDb();
    await routeWebhook(db, { event: 'star', deliveryId: 'd3', payload: {} });
    expect(taskCreate).not.toHaveBeenCalled();
    expect(gitEventCreate).not.toHaveBeenCalled();
  });
});
