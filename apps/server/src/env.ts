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

  // Bootstrap admins: comma-separated GitHub logins promoted to `admin` on sign-in.
  ADMIN_GITHUB_LOGINS: (process.env.ADMIN_GITHUB_LOGINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Email digests (SMTP). Port 465 ⇒ implicit TLS (secure=true); 587 ⇒ STARTTLS.
  SMTP_HOST: process.env.SMTP_HOST ?? '',
  SMTP_PORT: num('SMTP_PORT', 465),
  SMTP_SECURE: (process.env.SMTP_SECURE ?? (num('SMTP_PORT', 465) === 465 ? 'true' : 'false')) !== 'false',
  SMTP_USER: process.env.SMTP_USER ?? '',
  SMTP_PASS: process.env.SMTP_PASS ?? '',
  MAIL_FROM: process.env.MAIL_FROM ?? '',
  // Extra fixed recipients for the admin digest (comma-separated), beyond every
  // admin with an email on file. Useful when a GitHub email is private.
  DIGEST_TO: (process.env.DIGEST_TO ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Tunables (§6/§11)
  IDLE_MINUTES: num('IDLE_MINUTES', 90),
  MAX_OPEN_HOURS: num('MAX_OPEN_HOURS', 8),
  OVERRUN_FACTOR: num('OVERRUN_FACTOR', 1.5),

  get isProd() {
    return this.NODE_ENV === 'production';
  },
};
