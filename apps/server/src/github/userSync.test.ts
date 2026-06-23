import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncUserProjects } from './userSync';
import type { Db } from '../sync/upsert';

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeDb() {
  const installUpsert = vi.fn(async (a: any) => ({ id: `inst${a.where.githubInstallationId}` }));
  const repoUpsert = vi.fn(async (a: any) => ({ id: `repo${a.where.githubRepoId}` }));
  const taskCreate = vi.fn(async (a: any) => ({ id: 't', ...a.data }));
  const db = {
    installation: { upsert: installUpsert },
    repo: { upsert: repoUpsert },
    task: { findFirst: vi.fn(async () => null), create: taskCreate, update: vi.fn() },
  } as unknown as Db;
  return { db, installUpsert, repoUpsert, taskCreate };
}

function mockFetch(map: Record<string, any>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace('https://api.github.com', '');
      const key = Object.keys(map).find((k) => path.startsWith(k));
      if (!key) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => map[key] };
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('syncUserProjects', () => {
  it('seeds tasks from assigned issues/PRs and authored PRs', async () => {
    const owner = { id: 5, login: 'acme' };
    mockFetch({
      '/issues?filter=assigned': [
        { number: 1, title: 'Issue one', labels: [{ name: 'est:2h' }], repository: { id: 10, full_name: 'acme/web', default_branch: 'main', owner } },
        { number: 2, title: 'Assigned PR', pull_request: {}, labels: [], repository: { id: 10, full_name: 'acme/web', owner } },
      ],
      '/search/issues': { items: [{ number: 7, title: 'My PR', repository_url: 'https://api.github.com/repos/acme/api', draft: false }] },
      '/repos/acme/api': { id: 11, full_name: 'acme/api', default_branch: 'main', owner },
    });

    const { db, installUpsert, taskCreate } = fakeDb();
    const result = await syncUserProjects(db, 'tok', 'user1', 'me');

    expect(result.tasks).toBe(3);
    expect(result.repos).toBe(2);
    // synthetic installation id is the negated owner id
    expect(installUpsert.mock.calls[0]![0].where.githubInstallationId).toBe(-5n);
    const issueTask = taskCreate.mock.calls.find((c) => c[0].data.githubNumber === 1)![0].data;
    expect(issueTask).toMatchObject({ source: 'issue', status: 'in_progress', estimateMinutes: 120, assigneeUserId: 'user1' });
    const assignedPr = taskCreate.mock.calls.find((c) => c[0].data.githubNumber === 2)![0].data;
    expect(assignedPr).toMatchObject({ source: 'pr', status: 'in_review' });
  });
});
