import type {
  PrismaClient,
  TaskSource,
  TaskStatus,
  GitEventType,
} from '@cadence/db';

/** Minimal surface we use — lets tests pass a lightweight fake. */
export type Db = PrismaClient;

// ── Author resolution: githubId first, then any known UserEmail (§4) ─────────
export async function resolveAuthorUserId(
  db: Db,
  opts: { githubId?: number | bigint | null; email?: string | null },
): Promise<string | null> {
  if (opts.githubId != null) {
    const u = await db.user.findUnique({ where: { githubId: BigInt(opts.githubId) } });
    if (u) return u.id;
  }
  if (opts.email) {
    const ue = await db.userEmail.findUnique({ where: { email: opts.email.toLowerCase() } });
    if (ue) return ue.userId;
    const u = await db.user.findFirst({ where: { email: opts.email } });
    if (u) return u.id;
  }
  return null;
}

// ── Installation + Repo ──────────────────────────────────────────────────────
export async function upsertInstallation(
  db: Db,
  opts: { githubInstallationId: number | bigint; accountLogin: string },
): Promise<string> {
  const gid = BigInt(opts.githubInstallationId);
  const inst = await db.installation.upsert({
    where: { githubInstallationId: gid },
    create: { githubInstallationId: gid, accountLogin: opts.accountLogin },
    update: { accountLogin: opts.accountLogin, deletedAt: null },
  });
  return inst.id;
}

export async function upsertRepo(
  db: Db,
  opts: {
    githubRepoId: number | bigint;
    fullName: string;
    defaultBranch?: string;
    installationId: string;
  },
): Promise<string> {
  const gid = BigInt(opts.githubRepoId);
  const repo = await db.repo.upsert({
    where: { githubRepoId: gid },
    create: {
      githubRepoId: gid,
      fullName: opts.fullName,
      defaultBranch: opts.defaultBranch ?? 'main',
      installationId: opts.installationId,
    },
    update: {
      fullName: opts.fullName,
      ...(opts.defaultBranch ? { defaultBranch: opts.defaultBranch } : {}),
      deletedAt: null,
    },
  });
  return repo.id;
}

export async function findRepoByGithubId(db: Db, githubRepoId: number | bigint) {
  return db.repo.findUnique({ where: { githubRepoId: BigInt(githubRepoId) } });
}

// ── Tasks ────────────────────────────────────────────────────────────────────
interface TaskKey {
  repoId: string;
  source: TaskSource;
  githubNumber: number | null;
  branch: string | null;
}

/**
 * Upsert a task by its natural key. We use findFirst+create/update rather than
 * prisma upsert because the compound unique includes nullable columns.
 */
export async function upsertTask(
  db: Db,
  key: TaskKey,
  data: {
    title: string;
    status: TaskStatus;
    assigneeUserId?: string | null;
    estimateMinutes?: number | null;
    closedAt?: Date | null;
    bumpReopen?: boolean;
  },
): Promise<string> {
  const existing = await db.task.findFirst({
    where: {
      repoId: key.repoId,
      source: key.source,
      githubNumber: key.githubNumber,
      branch: key.branch,
    },
  });

  if (!existing) {
    const created = await db.task.create({
      data: {
        repoId: key.repoId,
        source: key.source,
        githubNumber: key.githubNumber,
        branch: key.branch,
        title: data.title,
        status: data.status,
        assigneeUserId: data.assigneeUserId ?? null,
        estimateMinutes: data.estimateMinutes ?? null,
        closedAt: data.closedAt ?? null,
      },
    });
    return created.id;
  }

  // reopen detection: was done/closed, now active again
  const reopening =
    data.bumpReopen === true ||
    (existing.closedAt != null && data.closedAt == null && data.status !== 'done');

  await db.task.update({
    where: { id: existing.id },
    data: {
      title: data.title,
      status: data.status,
      ...(data.assigneeUserId !== undefined ? { assigneeUserId: data.assigneeUserId } : {}),
      ...(data.estimateMinutes !== undefined ? { estimateMinutes: data.estimateMinutes } : {}),
      closedAt: data.closedAt ?? null,
      ...(reopening ? { reopenCount: { increment: 1 } } : {}),
      deletedAt: null,
    },
  });
  return existing.id;
}

// ── Git events (idempotent) ──────────────────────────────────────────────────
export async function appendGitEvent(
  db: Db,
  ev: {
    repoId: string;
    taskId?: string | null;
    authorUserId?: string | null;
    type: GitEventType;
    sha?: string | null;
    prNumber?: number | null;
    branch?: string | null;
    additions?: number | null;
    deletions?: number | null;
    filesChanged?: number | null;
    message?: string | null;
    occurredAt: Date;
    deliveryId?: string | null;
    raw?: unknown;
  },
): Promise<string | null> {
  // Idempotency: skip if we've already stored this delivery/object id.
  if (ev.deliveryId) {
    const dupe = await db.gitEvent.findUnique({ where: { deliveryId: ev.deliveryId } });
    if (dupe) return dupe.id;
  }
  const created = await db.gitEvent.create({
    data: {
      repoId: ev.repoId,
      taskId: ev.taskId ?? null,
      authorUserId: ev.authorUserId ?? null,
      type: ev.type,
      sha: ev.sha ?? null,
      prNumber: ev.prNumber ?? null,
      branch: ev.branch ?? null,
      additions: ev.additions ?? null,
      deletions: ev.deletions ?? null,
      filesChanged: ev.filesChanged ?? null,
      message: ev.message ?? null,
      occurredAt: ev.occurredAt,
      deliveryId: ev.deliveryId ?? null,
      raw: ev.raw == null ? undefined : (ev.raw as object),
    },
  });
  return created.id;
}

// ── Estimate label parsing (§7): est:<n>h / est:<n>d ─────────────────────────
export function parseEstimateFromLabels(labels: string[]): number | null {
  for (const raw of labels) {
    const m = /^est:\s*(\d+(?:\.\d+)?)\s*([hd])$/i.exec(raw.trim());
    if (m && m[1] && m[2]) {
      const n = parseFloat(m[1]);
      return m[2].toLowerCase() === 'd' ? Math.round(n * 8 * 60) : Math.round(n * 60);
    }
  }
  return null;
}
