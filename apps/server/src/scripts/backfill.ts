/**
 * Backfill (§4): on first install, seed tasks + git-events from recent history so
 * the timeline isn't empty on day one. Pages open issues/PRs, recent commits, and
 * merged PRs (~60 days) per repo using the installation token.
 *
 * Usage: node apps/server/dist/scripts/backfill.js [repoFullName]
 */
import { prisma } from '@cadence/db';
import type { TaskStatus } from '@cadence/db';
import { getInstallationOctokit, isGitHubAppConfigured } from '../github/app';
import {
  appendGitEvent,
  parseEstimateFromLabels,
  resolveAuthorUserId,
  upsertTask,
} from '../sync/upsert';

const SINCE_DAYS = 60;

async function backfillRepo(repoFullName: string): Promise<void> {
  const repo = await prisma.repo.findFirst({
    where: { fullName: repoFullName, deletedAt: null },
    include: { installation: true },
  });
  if (!repo) {
    console.error(`repo not found: ${repoFullName}`);
    return;
  }
  const octokit = await getInstallationOctokit(Number(repo.installation.githubInstallationId));
  const [owner, name] = repoFullName.split('/');
  if (!owner || !name) return;
  const since = new Date(Date.now() - SINCE_DAYS * 86400_000).toISOString();

  // Open issues (excluding PRs)
  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo: name,
    state: 'open',
    per_page: 100,
  });
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? '')));
    const assigneeUserId = await resolveAuthorUserId(prisma, { githubId: issue.assignee?.id ?? null });
    await upsertTask(
      prisma,
      { repoId: repo.id, source: 'issue', githubNumber: issue.number, branch: null },
      {
        title: issue.title,
        status: assigneeUserId ? 'in_progress' : 'todo',
        assigneeUserId,
        estimateMinutes: parseEstimateFromLabels(labels),
      },
    );
  }

  // Pull requests (open + recently merged)
  const prs = await octokit.paginate(octokit.pulls.list, {
    owner,
    repo: name,
    state: 'all',
    per_page: 100,
    sort: 'updated',
    direction: 'desc',
  });
  for (const pr of prs) {
    if (pr.updated_at < since) break;
    const merged = Boolean(pr.merged_at);
    const status: TaskStatus = merged
      ? 'done'
      : pr.draft
        ? 'in_progress'
        : pr.state === 'open'
          ? 'in_review'
          : 'done';
    const assigneeUserId = await resolveAuthorUserId(prisma, { githubId: pr.user?.id ?? null });
    await upsertTask(
      prisma,
      { repoId: repo.id, source: 'pr', githubNumber: pr.number, branch: pr.head?.ref ?? null },
      {
        title: pr.title,
        status,
        assigneeUserId,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      },
    );
  }

  // Recent commits on the default branch
  const commits = await octokit.paginate(octokit.repos.listCommits, {
    owner,
    repo: name,
    since,
    per_page: 100,
  });
  for (const c of commits) {
    const authorUserId = await resolveAuthorUserId(prisma, {
      githubId: c.author?.id ?? null,
      email: c.commit?.author?.email ?? null,
    });
    await appendGitEvent(prisma, {
      repoId: repo.id,
      authorUserId,
      type: 'commit',
      sha: c.sha,
      message: c.commit?.message ?? null,
      occurredAt: new Date(c.commit?.author?.date ?? Date.now()),
      deliveryId: `backfill:${repo.id}:${c.sha}`,
    });
  }

  console.log(`backfilled ${repoFullName}: ${issues.length} issues, ${prs.length} PRs, ${commits.length} commits`);
}

async function main(): Promise<void> {
  if (!isGitHubAppConfigured()) {
    console.error('GitHub App not configured — skipping backfill.');
    return;
  }
  const arg = process.argv[2];
  const repos = arg
    ? [{ fullName: arg }]
    : await prisma.repo.findMany({ where: { deletedAt: null }, select: { fullName: true } });
  for (const r of repos) {
    try {
      await backfillRepo(r.fullName);
    } catch (err) {
      console.error(`backfill failed for ${r.fullName}:`, err);
    }
  }
}

void main().finally(() => prisma.$disconnect());
