import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBranch, CreateBranchError, slugBranch } from './createBranch';

describe('createBranch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('slugBranch builds a safe, deterministic name', () => {
    expect(slugBranch('Ship Onboarding Flow!', 'abc123xyz')).toBe('cadence/ship-onboarding-flow-abc123');
    expect(slugBranch('   ', 'zzzzzz0000')).toBe('cadence/task-zzzzzz');
  });

  it('creates a branch off the base head (201) with the base sha', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ object: { sha: 'deadbeef' } }) })
      .mockResolvedValueOnce({ status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    const res = await createBranch('tok', 'acme/api', 'main', 'cadence/x');
    expect(res).toEqual({ branch: 'cadence/x', created: true });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toEqual({ ref: 'refs/heads/cadence/x', sha: 'deadbeef' });
  });

  it('treats an already-existing branch (422) as linked, not an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ object: { sha: 's' } }) })
        .mockResolvedValueOnce({ status: 422 }),
    );
    expect(await createBranch('tok', 'acme/api', 'main', 'b')).toEqual({ branch: 'b', created: false });
  });

  it('throws when the base ref is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }));
    await expect(createBranch('tok', 'acme/api', 'main', 'b')).rejects.toBeInstanceOf(CreateBranchError);
  });
});
