import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import { env } from '../env';

let cached: App | null = null;

/** Is the GitHub App configured (creds present)? */
export function isGitHubAppConfigured(): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}

/** Lazily construct the Octokit App (App JWT auth). Throws if unconfigured. */
export function getApp(): App {
  if (!isGitHubAppConfigured()) {
    throw new Error('GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)');
  }
  if (cached) return cached;
  cached = new App({
    appId: env.GITHUB_APP_ID,
    // DO stores the key with literal \n; normalise to real newlines.
    privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    oauth: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    webhooks: { secret: env.GITHUB_WEBHOOK_SECRET },
    // Use the REST-capable Octokit so installation clients have .issues/.pulls/.paginate.
    Octokit,
  });
  return cached;
}

/**
 * Get an installation-scoped Octokit (short-lived token, auto-refreshed by
 * Octokit) for background reads / backfills.
 */
export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const app = getApp();
  // octokit instance typed loosely across @octokit/app vs @octokit/rest
  return (await app.getInstallationOctokit(installationId)) as unknown as Octokit;
}
