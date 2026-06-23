import type { TaskStatus } from '@cadence/db';
import {
  appendGitEvent,
  findRepoByGithubId,
  parseEstimateFromLabels,
  resolveAuthorUserId,
  setRepoLatestVersion,
  upsertInstallation,
  upsertRepo,
  upsertTask,
  type Db,
} from '../sync/upsert';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyPayload = Record<string, any>;

export interface IncomingWebhook {
  event: string;
  deliveryId: string;
  payload: AnyPayload;
}

/** Route a verified webhook to task/git-event sync. Idempotent + best-effort. */
export async function routeWebhook(db: Db, hook: IncomingWebhook): Promise<void> {
  const { event, payload, deliveryId } = hook;
  switch (event) {
    case 'installation':
    case 'installation_repositories':
      return handleInstallation(db, payload);
    case 'issues':
      return handleIssues(db, payload, deliveryId);
    case 'pull_request':
      return handlePullRequest(db, payload, deliveryId);
    case 'pull_request_review':
      return handlePullRequestReview(db, payload, deliveryId);
    case 'push':
      return handlePush(db, payload, deliveryId);
    case 'release':
      return handleRelease(db, payload, deliveryId);
    default:
      return;
  }
}

async function handleRelease(db: Db, payload: AnyPayload, deliveryId: string): Promise<void> {
  const rel = payload.release;
  const repo = await findRepoByGithubId(db, payload.repository?.id);
  if (!rel || !repo || rel.draft) return;
  const tag = rel.tag_name ?? rel.name;
  if (!tag) return;
  const at = new Date(rel.published_at ?? rel.created_at ?? Date.now());
  await setRepoLatestVersion(db, repo.id, String(tag), at);
  await appendGitEvent(db, {
    repoId: repo.id,
    authorUserId: await resolveAuthorUserId(db, { githubId: rel.author?.id ?? null }),
    type: 'release',
    branch: String(tag),
    message: rel.name ?? String(tag),
    occurredAt: at,
    deliveryId,
  });
}

async function handleInstallation(db: Db, payload: AnyPayload): Promise<void> {
  const inst = payload.installation;
  if (!inst) return;
  const installationId = await upsertInstallation(db, {
    githubInstallationId: inst.id,
    accountLogin: inst.account?.login ?? 'unknown',
  });
  const repos: AnyPayload[] = payload.repositories ?? payload.repositories_added ?? [];
  for (const r of repos) {
    await upsertRepo(db, {
      githubRepoId: r.id,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      installationId,
    });
  }
}

async function handleIssues(db: Db, payload: AnyPayload, _deliveryId: string): Promise<void> {
  const issue = payload.issue;
  const repo = await findRepoByGithubId(db, payload.repository?.id);
  if (!issue || !repo || issue.pull_request) return; // PRs come via pull_request

  const assigneeUserId = await resolveAuthorUserId(db, {
    githubId: issue.assignee?.id ?? null,
  });
  const labels: string[] = (issue.labels ?? []).map((l: AnyPayload) =>
    typeof l === 'string' ? l : l.name,
  );
  const closed = issue.state === 'closed';
  const status: TaskStatus = closed ? 'done' : assigneeUserId ? 'in_progress' : 'todo';

  await upsertTask(
    db,
    { repoId: repo.id, source: 'issue', githubNumber: issue.number, branch: null },
    {
      title: issue.title ?? `Issue #${issue.number}`,
      status,
      assigneeUserId,
      estimateMinutes: parseEstimateFromLabels(labels),
      closedAt: closed ? new Date(issue.closed_at ?? Date.now()) : null,
      bumpReopen: payload.action === 'reopened',
      milestoneTitle: issue.milestone?.title ?? null,
      milestoneDueOn: issue.milestone?.due_on ? new Date(issue.milestone.due_on) : null,
    },
  );
}

async function handlePullRequest(db: Db, payload: AnyPayload, deliveryId: string): Promise<void> {
  const pr = payload.pull_request;
  const repo = await findRepoByGithubId(db, payload.repository?.id);
  if (!pr || !repo) return;

  const merged = pr.merged === true || payload.action === 'closed' && pr.merged_at;
  const closedNotMerged = pr.state === 'closed' && !merged;
  const status: TaskStatus = merged
    ? 'done'
    : pr.draft
      ? 'in_progress'
      : pr.state === 'open'
        ? 'in_review'
        : 'done';

  const assigneeUserId = await resolveAuthorUserId(db, { githubId: pr.user?.id ?? null });

  await upsertTask(
    db,
    { repoId: repo.id, source: 'pr', githubNumber: pr.number, branch: pr.head?.ref ?? null },
    {
      title: pr.title ?? `PR #${pr.number}`,
      status,
      assigneeUserId,
      closedAt: merged || closedNotMerged ? new Date(pr.closed_at ?? Date.now()) : null,
      bumpReopen: payload.action === 'reopened',
      milestoneTitle: pr.milestone?.title ?? null,
      milestoneDueOn: pr.milestone?.due_on ? new Date(pr.milestone.due_on) : null,
    },
  );

  const type = merged ? 'pr_merged' : payload.action === 'closed' ? 'pr_closed' : 'pr_opened';
  if (payload.action === 'opened' || payload.action === 'closed' || payload.action === 'reopened') {
    await appendGitEvent(db, {
      repoId: repo.id,
      authorUserId: assigneeUserId,
      type,
      prNumber: pr.number,
      branch: pr.head?.ref ?? null,
      additions: pr.additions ?? null,
      deletions: pr.deletions ?? null,
      filesChanged: pr.changed_files ?? null,
      message: pr.title ?? null,
      occurredAt: new Date(pr.updated_at ?? Date.now()),
      deliveryId,
    });
  }
}

async function handlePullRequestReview(
  db: Db,
  payload: AnyPayload,
  deliveryId: string,
): Promise<void> {
  const review = payload.review;
  const pr = payload.pull_request;
  const repo = await findRepoByGithubId(db, payload.repository?.id);
  if (!review || !pr || !repo) return;
  const authorUserId = await resolveAuthorUserId(db, { githubId: review.user?.id ?? null });
  await appendGitEvent(db, {
    repoId: repo.id,
    authorUserId,
    type: 'pr_review',
    prNumber: pr.number,
    branch: pr.head?.ref ?? null,
    message: review.state ?? null,
    occurredAt: new Date(review.submitted_at ?? Date.now()),
    deliveryId,
  });
}

async function handlePush(db: Db, payload: AnyPayload, deliveryId: string): Promise<void> {
  const repo = await findRepoByGithubId(db, payload.repository?.id);
  if (!repo) return;
  const branch: string | null = (payload.ref ?? '').replace('refs/heads/', '') || null;
  const commits: AnyPayload[] = payload.commits ?? [];

  // Try to attribute to a branch-linked task (full attribution lands in P3).
  const branchTask = branch
    ? await db.task.findFirst({
        where: { repoId: repo.id, branch, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
      })
    : null;

  for (const c of commits) {
    const authorUserId = await resolveAuthorUserId(db, {
      githubId: c.author?.id ?? null,
      email: c.author?.email ?? null,
    });
    await appendGitEvent(db, {
      repoId: repo.id,
      taskId: branchTask?.id ?? null,
      authorUserId,
      type: 'commit',
      sha: c.id,
      branch,
      additions: c.added?.length ?? null,
      deletions: c.removed?.length ?? null,
      filesChanged:
        (c.added?.length ?? 0) + (c.removed?.length ?? 0) + (c.modified?.length ?? 0) || null,
      message: c.message ?? null,
      occurredAt: new Date(c.timestamp ?? Date.now()),
      // unique per (delivery, sha) so multiple commits in one push all persist
      deliveryId: `${deliveryId}:${c.id}`,
    });
  }
}
