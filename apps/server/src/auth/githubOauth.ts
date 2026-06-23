import { env } from '../env';

const GH = 'https://github.com';
const GH_API = 'https://api.github.com';

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}

export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/** Build the App OAuth (user-to-server) authorize URL. */
export function buildAuthorizeUrl(state: string): string {
  const u = new URL(`${GH}/login/oauth/authorize`);
  u.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  u.searchParams.set('redirect_uri', `${env.APP_BASE_URL}/auth/github/callback`);
  u.searchParams.set('state', state);
  // identity only; repo data arrives via the installation, not the user token
  u.searchParams.set('scope', 'read:user user:email');
  return u.toString();
}

/** Exchange an OAuth code for a user access token. */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const res = await fetch(`${GH}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_BASE_URL}/auth/github/callback`,
    }),
  });
  if (!res.ok) throw new Error(`github token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(`github token exchange: ${json.error ?? 'no token'}`);
  return json.access_token;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cadence',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const res = await fetch(`${GH_API}/user`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GET /user failed: ${res.status}`);
  return (await res.json()) as GitHubUser;
}

export async function fetchUserEmails(token: string): Promise<GitHubEmail[]> {
  const res = await fetch(`${GH_API}/user/emails`, { headers: ghHeaders(token) });
  if (!res.ok) return [];
  return (await res.json()) as GitHubEmail[];
}
