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
      '/user/repos': [
        { id: 12, name: 'infra', full_name: 'acme/infra', default_branch: 'main', owner, pushed_at: new Date().toISOString() },
        { id: 13, name: 'stale', full_name: 'acme/stale', default_branch: 'main', owner, pushed_at: '2000-01-01T00:00:00Z' },
        { id: 14, name: 'archived', full_name: 'acme/archived', owner, archived: true },
      ],
    });

    const { db, installUpsert, taskCreate } = fakeDb();
    const result = await syncUserProjects(db, 'tok', 'user1', 'me');

    // 1 issue + 1 assigned PR + 1 authored PR + 1 recent repo (stale/archived skipped)
    expect(result.tasks).toBe(4);
    expect(result.repos).toBe(3);
    const branchTask = taskCreate.mock.calls.find((c) => c[0].data.source === 'branch')![0].data;
    expect(branchTask).toMatchObject({ source: 'branch', title: 'infra', branch: 'main' });
    // synthetic installation id is the negated owner id
    expect(installUpsert.mock.calls[0]![0].where.githubInstallationId).toBe(-5n);
    const issueTask = taskCreate.mock.calls.find((c) => c[0].data.githubNumber === 1)![0].data;
    expect(issueTask).toMatchObject({ source: 'issue', status: 'in_progress', estimateMinutes: 120, assigneeUserId: 'user1' });
    const assignedPr = taskCreate.mock.calls.find((c) => c[0].data.githubNumber === 2)![0].data;
    expect(assignedPr).toMatchObject({ source: 'pr', status: 'in_review' });
  });
});
