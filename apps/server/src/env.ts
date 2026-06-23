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

  // Static bearer token for machine integrations (e.g. the external activity-check
  // robot). When unset, the /api/integrations/* endpoints return 503.
  CADENCE_API_TOKEN: process.env.CADENCE_API_TOKEN ?? '',

  // Login-reminder emails (§ inactivity nudges). Thresholds in hours; the check
  // runs at LOGIN_CHECK_HOUR (local) every day except Friday (excluded from the gap).
  LOGIN_CHECK_HOUR: num('LOGIN_CHECK_HOUR', 9),
  INACTIVE_REMIND_HOURS: num('INACTIVE_REMIND_HOURS', 24),
  INACTIVE_URGENT_HOURS: num('INACTIVE_URGENT_HOURS', 48),
  // Who gets the URGENT 48h alert (besides admins): comma-separated.
  URGENT_NOTIFY_EMAILS: (process.env.URGENT_NOTIFY_EMAILS ?? 'arman@arks.ae')
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
