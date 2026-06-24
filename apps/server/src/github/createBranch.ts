// Create a branch in a connected repo on the user's behalf, using their stored
// OAuth token (classic `repo` scope). Same raw-fetch style as webhookSetup.ts so
// we don't pull in a GitHub App dependency. Used when a manual task "needs git".
const GH_API = 'https://api.github.com';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cadence',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

/** Deterministic, GitHub-safe branch name for a task: `cadence/<slug>-<id6>`. */
export function slugBranch(title: string, id: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task';
  return `cadence/${slug}-${id.slice(0, 6)}`;
}

export class CreateBranchError extends Error {
  constructor(public code: string, public status?: number) {
    super(code);
  }
}

/**
 * Create `newBranch` off the head of `baseBranch`. Idempotent: if the branch
 * already exists (422) we treat it as linked rather than an error.
 * Returns whether a new ref was actually created.
 */
export async function createBranch(
  token: string,
  fullName: string,
  baseBranch: string,
  newBranch: string,
): Promise<{ branch: string; created: boolean }> {
  const refRes = await fetch(
    `${GH_API}/repos/${fullName}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
    { headers: headers(token) },
  );
  if (!refRes.ok) throw new CreateBranchError('base_ref_unavailable', refRes.status);
  const ref = (await refRes.json()) as { object?: { sha?: string } };
  const sha = ref?.object?.sha;
  if (!sha) throw new CreateBranchError('no_base_sha');

  const createRes = await fetch(`${GH_API}/repos/${fullName}/git/refs`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha }),
  });
  if (createRes.status === 201) return { branch: newBranch, created: true };
  if (createRes.status === 422) return { branch: newBranch, created: false }; // already exists → link
  throw new CreateBranchError('create_ref_failed', createRes.status);
}
