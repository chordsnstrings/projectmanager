// Per-user project/task fetch (the OAuth-token path): pull the signed-in user's
// assigned open issues + authored open PRs and seed Repo/Task rows, so a dev sees
// their projects immediately without an org-wide GitHub App install.
import {
  appendGitEvent,
  parseEstimateFromLabels,
  upsertInstallation,
  upsertRepo,
  upsertTask,
  type Db,
} from '../sync/upsert';
import { env } from '../env';
import { ensureRepoWebhooks, type RepoForHook } from './webhookSetup';

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
  try {
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
  } catch {
    /* best-effort: a failing phase shouldn't lose the others */
  }

  // 2) Open PRs authored by the user (search). Resolve repo (id/default_branch) via cache.
  const repoCache = new Map<string, any>();
  try {
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
  } catch {
    /* ignore */
  }

  // 3) The user's recently-active repos → one "branch" task per repo, titled by
  //    the repo name. This is why a dev with no open issues/PRs still sees their
  //    projects (named by repo) instead of resorting to "off-task".
  try {
    const repos: any[] = await ghGet(
      token,
      '/user/repos?sort=pushed&per_page=30&affiliation=owner,collaborator,organization_member',
    );
    const cutoff = Date.now() - 60 * 86_400_000; // last 60 days of activity
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString(); // commits window
    // Cap the number of repos we deep-sync commits for, to bound API calls.
    const active = repos
      .filter((r) => r?.owner && !r.archived && !r.disabled && (!r.pushed_at || Date.parse(r.pushed_at) >= cutoff))
      .slice(0, 12);

    // Register real-time webhooks on the repos this user administers (best-effort,
    // idempotent) so push/PR/review/issue events flow in live for the whole repo.
    if (env.GITHUB_WEBHOOK_SECRET && env.APP_BASE_URL.startsWith('https://')) {
      const hookUrl = `${env.APP_BASE_URL}/webhooks/github`;
      const hookRepos: RepoForHook[] = active
        .filter((r) => r.permissions?.admin !== false)
        .map((r) => ({ fullName: r.full_name, admin: r.permissions?.admin }));
      await ensureRepoWebhooks(token, hookRepos, hookUrl, env.GITHUB_WEBHOOK_SECRET).catch(() => {});
    }

    for (const repo of active) {
      const repoId = await upsertRepoFrom(db, repo);
      repoIds.add(repoId);
      const branchTaskId = await upsertTask(
        db,
        { repoId, source: 'branch', githubNumber: null, branch: repo.default_branch ?? 'main' },
        {
          title: repo.name ?? repo.full_name,
          status: 'in_progress',
          assigneeUserId: userId,
          closedAt: null,
        },
      );
      tasks++;

      // Ingest the user's recent commits → git-events (so the timeline, flags,
      // nudges, and attribution have real data even without the App webhooks).
      try {
        const commits: any[] = await ghGet(
          token,
          `/repos/${repo.full_name}/commits?author=${encodeURIComponent(login)}&since=${since}&per_page=20`,
        );
        for (const c of commits) {
          await appendGitEvent(db, {
            repoId,
            taskId: branchTaskId,
            authorUserId: userId,
            type: 'commit',
            sha: c.sha,
            branch: repo.default_branch ?? 'main',
            message: c.commit?.message ?? null,
            occurredAt: new Date(c.commit?.author?.date ?? Date.now()),
            deliveryId: `usersync:${repoId}:${c.sha}`,
          });
        }
      } catch {
        /* commits are best-effort */
      }
    }
  } catch {
    /* ignore */
  }

  return { tasks, repos: repoIds.size };
}

/**
 * Lightweight live check: for each of the user's OPEN task-sessions, pull just
 * that repo's recent commits by the user since the session started and ingest
 * them (attributed to the session's task). Cheap (one repo per running session)
 * so it can be polled — pairs with autoStopOnCommit to stop the timer on commit
 * without webhooks. Returns the number of commits ingested.
 */
export async function syncRunningSessionCommits(
  db: Db,
  token: string,
  userId: string,
  login: string,
): Promise<number> {
  const open = await db.session.findMany({
    where: { isOpen: true, deletedAt: null, taskId: { not: null }, userId },
    include: { task: { include: { repo: true } } },
  });
  let ingested = 0;
  const seenRepo = new Set<string>();
  for (const s of open) {
    const repo = s.task?.repo;
    if (!repo || !s.taskId) continue;
    const cacheKey = `${repo.id}:${s.startedAt.getTime()}`;
    if (seenRepo.has(cacheKey)) continue;
    seenRepo.add(cacheKey);
    try {
      const since = s.startedAt.toISOString();
      const commits: any[] = await ghGet(
        token,
        `/repos/${repo.fullName}/commits?author=${encodeURIComponent(login)}&since=${since}&per_page=10`,
      );
      for (const c of commits) {
        const created = await appendGitEvent(db, {
          repoId: repo.id,
          taskId: s.taskId,
          authorUserId: userId,
          type: 'commit',
          sha: c.sha,
          branch: repo.defaultBranch,
          message: c.commit?.message ?? null,
          occurredAt: new Date(c.commit?.author?.date ?? Date.now()),
          deliveryId: `live:${repo.id}:${c.sha}`,
        });
        if (created) ingested++;
      }
    } catch {
      /* best-effort */
    }
  }
  return ingested;
}
