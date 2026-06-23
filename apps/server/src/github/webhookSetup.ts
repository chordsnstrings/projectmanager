// Register repo webhooks using the signed-in user's OAuth token (classic `repo`
// scope includes repo hook admin for repos the user administers). This gives us
// real-time push / PR / review / issue events — and full attribution including
// teammate and bot commits — without a separate GitHub App.
//
// Idempotent: a hook pointing at our URL is reused (and its config refreshed so
// the secret + events stay current); otherwise one is created. Best-effort — a
// repo where the user lacks admin (403/404) is silently skipped.
/* eslint-disable @typescript-eslint/no-explicit-any */
const GH_API = 'https://api.github.com';

const HOOK_EVENTS = ['push', 'pull_request', 'pull_request_review', 'issues'];

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cadence',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

export type EnsureResult = 'created' | 'updated' | 'skipped' | 'error';

/** Ensure exactly one Cadence webhook exists on `fullName` pointing at `hookUrl`. */
export async function ensureRepoWebhook(
  token: string,
  fullName: string,
  hookUrl: string,
  secret: string,
): Promise<EnsureResult> {
  const config = { url: hookUrl, content_type: 'json', secret, insecure_ssl: '0' };
  try {
    const listRes = await fetch(`${GH_API}/repos/${fullName}/hooks?per_page=100`, {
      headers: headers(token),
    });
    if (listRes.status === 403 || listRes.status === 404) return 'skipped'; // not an admin of this repo
    if (!listRes.ok) return 'error';
    const hooks = (await listRes.json()) as any[];
    const existing = hooks.find((h) => h?.config?.url === hookUrl);

    if (existing) {
      // Refresh config (rotates the secret if it changed) + events, ensure active.
      const patchRes = await fetch(`${GH_API}/repos/${fullName}/hooks/${existing.id}`, {
        method: 'PATCH',
        headers: headers(token),
        body: JSON.stringify({ active: true, events: HOOK_EVENTS, config }),
      });
      return patchRes.ok ? 'updated' : 'error';
    }

    const createRes = await fetch(`${GH_API}/repos/${fullName}/hooks`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ name: 'web', active: true, events: HOOK_EVENTS, config }),
    });
    if (createRes.status === 403 || createRes.status === 404) return 'skipped';
    return createRes.ok ? 'created' : 'error';
  } catch {
    return 'error';
  }
}

export interface RepoForHook {
  fullName: string;
  /** the OAuth user's permission flag, when known (only admins can manage hooks) */
  admin?: boolean;
}

/**
 * Ensure webhooks across a set of repos. Skips repos the user clearly can't admin.
 * Returns counts by outcome. No-op (skips all) when `secret` is empty.
 */
export async function ensureRepoWebhooks(
  token: string,
  repos: RepoForHook[],
  hookUrl: string,
  secret: string,
): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
  const out = { created: 0, updated: 0, skipped: 0, errors: 0 };
  if (!secret || !hookUrl.startsWith('https://')) {
    out.skipped = repos.length;
    return out;
  }
  const seen = new Set<string>();
  for (const r of repos) {
    if (seen.has(r.fullName)) continue;
    seen.add(r.fullName);
    if (r.admin === false) {
      out.skipped++;
      continue;
    }
    const res = await ensureRepoWebhook(token, r.fullName, hookUrl, secret);
    if (res === 'created') out.created++;
    else if (res === 'updated') out.updated++;
    else if (res === 'skipped') out.skipped++;
    else out.errors++;
  }
  return out;
}
