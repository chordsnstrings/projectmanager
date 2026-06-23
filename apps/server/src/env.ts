// Centralised env access with sane defaults for tunables (§11).
function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: num('PORT', 8080),
  APP_BASE_URL: process.env.APP_BASE_URL ?? 'http://localhost:8080',
  SESSION_SECRET: process.env.SESSION_SECRET ?? '',
  DATABASE_URL: process.env.DATABASE_URL ?? '',

  // GitHub App + OAuth (§4) — populated in P1
  GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? '',
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY ?? '',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? '',
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ?? '',

  // Tunables (§6/§11)
  IDLE_MINUTES: num('IDLE_MINUTES', 90),
  MAX_OPEN_HOURS: num('MAX_OPEN_HOURS', 8),
  OVERRUN_FACTOR: num('OVERRUN_FACTOR', 1.5),

  get isProd() {
    return this.NODE_ENV === 'production';
  },
};
