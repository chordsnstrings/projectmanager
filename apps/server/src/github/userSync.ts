// Per-user project/task fetch (the OAuth-token path): pull the signed-in user's
// assigned open issues + authored open PRs and seed Repo/Task rows, so a dev sees
// their projects immediately without an org-wide GitHub App install.
import {
  parseEstimateFromLabels,
  upsertInstallation,
  upsertRepo,
  upsertTask,
  type Db,
} from '../sync/upsert';

const GH_API = 'https://api.github.com';

/* eslint-disable @typescript-eslint/no-explicit-any */
function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cadence',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghGet(token: string, path: string): Promise<any> {
  const res = await fetch(`${GH_API}${path}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

/** Upsert a synthetic Installation for an OAuth-sourced repo owner (no GitHub App). */
async function syntheticInstallation(db: Db, owner: { id: number; login: string }): Promise<string> {
  // Negative id namespaces these apart from real (positive) installation ids.
  return upsertInstallation(db, { githubInstallationId: -BigInt(owner.id), accountLogin: owner.login });
}

async function upsertRepoFrom(
  db: Db,
  repo: { id: number; full_name: string; default_branch?: string; owner: { id: number; login: string } },
): Promise<string> {
  const installationId = await syntheticInstallation(db, repo.owner);
  return upsertRepo(db, {
    githubRepoId: repo.id,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch ?? 'main',
    installationId,
  });
}

export interface SyncResult {
  tasks: number;
  repos: number;
}

/**
 * Sync the user's assigned open issues + authored open PRs into Repo/Task rows.
 * Best-effort and idempotent (upserts keyed on natural ids).
 */
export async function syncUserProjects(
  db: Db,
  token: string,
  userId: string,
  login: string,
): Promise<SyncResult> {
  const repoIds = new Set<string>();
  let tasks = 0;

  // 1) Issues + PRs assigned to the authenticated user (includes `repository`).
  const assigned: any[] = await ghGet(token, '/issues?filter=assigned&state=open&per_page=100');
  for (const item of assigned) {
    const repo = item.repository;
    if (!repo?.owner) continue;
    const repoId = await upsertRepoFrom(db, repo);
    repoIds.add(repoId);
    const isPr = Boolean(item.pull_request);
    const labels: string[] = (item.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name));
    await upsertTask(
      db,
      { repoId, source: isPr ? 'pr' : 'issue', githubNumber: item.number, branch: null },
      {
        title: item.title ?? `#${item.number}`,
        status: isPr ? 'in_review' : 'in_progress',
        assigneeUserId: userId,
        estimateMinutes: parseEstimateFromLabels(labels),
        closedAt: null,
      },
    );
    tasks++;
  }

  // 2) Open PRs authored by the user (search). Resolve repo (id/default_branch) via cache.
  const repoCache = new Map<string, any>();
  const q = encodeURIComponent(`is:open is:pr author:${login}`);
  const search = await ghGet(token, `/search/issues?q=${q}&per_page=100`);
  for (const item of search.items ?? []) {
    const fullName = String(item.repository_url ?? '').replace(`${GH_API}/repos/`, '');
    if (!fullName.includes('/')) continue;
    let repo = repoCache.get(fullName);
    if (!repo) {
      try {
        repo = await ghGet(token, `/repos/${fullName}`);
        repoCache.set(fullName, repo);
      } catch {
        continue;
      }
    }
    const repoId = await upsertRepoFrom(db, repo);
    repoIds.add(repoId);
    await upsertTask(
      db,
      { repoId, source: 'pr', githubNumber: item.number, branch: null },
      {
        title: item.title ?? `PR #${item.number}`,
        status: item.draft ? 'in_progress' : 'in_review',
        assigneeUserId: userId,
        closedAt: null,
      },
    );
    tasks++;
  }

  return { tasks, repos: repoIds.size };
}
