# Cadence

A session-based engineering-visibility tool for a remote dev team. **Sessions are the
clock, git is the source of truth, tasks come from the repos, and the manager gets a
granular timeline + a question gate.** A developer's entire daily input is *tap start,
tap stop, accept one line* — everything else (tasks, status, activity, commits,
durations) is observed from GitHub.

> Live: **https://cadence-x54b8.ondigitalocean.app** (DigitalOcean App Platform, region `blr1`)

## Architecture
Single repo, single deployable. Fastify serves the JSON API **and** the built SPA.

```
apps/server/     Fastify API + GitHub webhook handler + serves ../web/dist   (@cadence/server)
apps/web/        React + Vite + Tailwind SPA (dark "engineering instrument")  (@cadence/web)
packages/db/     Prisma schema + client singleton + migrations               (@cadence/db)
packages/shared/ Shared TS DTO types used by server + web                     (@cadence/shared)
.do/app.yaml     DigitalOcean App Platform spec
```

- **Backend:** Node 20+, TypeScript, Fastify, Prisma, Octokit. CommonJS via `tsc`.
- **Frontend:** React + Vite + Tailwind (design tokens in `tailwind.config.ts`).
- **DB:** PostgreSQL 17 (DO Managed). **Auth:** GitHub OAuth → signed httpOnly cookie.
- Conventions: UTC `timestamptz`; soft-delete `deletedAt`; integer minute durations;
  paginated lists; idempotent, signature-verified webhooks; flags never auto-block.

## API surface (§8)
`/healthz` · `/auth/github` → `/auth/github/callback` · `/auth/logout` · `/me` ·
`/webhooks/github` · `/tasks` · `/sessions` (+ `/:id/stop`, `/active`, `/:id/activity`,
`/:id/draft-summary`) · `/nudges` · `/flags` · `/questions` (+ `/:id/answer`) ·
`/dashboard/team` · `/dashboard/user/:id/day` · `/dashboard/user/:id/trends`.
Dev-scoped to self; admin-scoped to all.

## Local development
```bash
npm ci
# point DATABASE_URL at a local Postgres, then:
npm run migrate:dev            # apply migrations
npm run build && npm run start:server   # http://localhost:8080
# or: npm run dev               # server + Vite SPA with proxy
npm test                        # vitest (engine units + authed integration)
```
Copy `.env.example` → `.env` and fill values.

## Deployment (DigitalOcean App Platform)
Already provisioned under the **`cadence`** project:
- **App:** `cadence` (web service + `PRE_DEPLOY` migrate job + `SCHEDULED` reconcile job).
- **Managed Postgres 17:** `cadence-db` (`blr1`), attached → injects `${db.DATABASE_URL}`.
- Auto-deploys on push to the configured branch; migrations run automatically pre-deploy.

The spec lives in `.do/app.yaml` (`doctl apps create --spec .do/app.yaml` to recreate).
`NODE_ENV=production` is **run-time only** — at build time it must be unset so `npm ci`
installs the devDeps (`tsc`/`vite`/`prisma`) the build needs. The SCHEDULED cron is `*/15`
(DO requires ≥15-min intervals).

## Remaining manual setup (GitHub App)
The data sync needs a **GitHub App that also does user OAuth** (§4). It can't be created
via the DO API — register it once and set the secrets in the DO Control Panel (Encrypted):

1. Create a GitHub App (org-owned). Repo permissions (read-only): Contents, Metadata,
   Pull requests, Issues. Subscribe to: `push`, `pull_request`, `pull_request_review`,
   `issues`, `installation`, `installation_repositories`.
2. Webhook URL `https://<app>.ondigitalocean.app/webhooks/github`; set a webhook secret.
   Enable "Request user authorization (OAuth) during installation"; callback
   `https://<app>.ondigitalocean.app/auth/github/callback`.
3. In DO → the `cadence` app → Settings → set encrypted env vars: `GITHUB_APP_ID`,
   `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
   `GITHUB_WEBHOOK_SECRET`. (`SESSION_SECRET` is already set; `DATABASE_URL`/`APP_BASE_URL`
   are auto-injected.)
4. Install the App on the org/repos. The `installation` webhook seeds repos; run
   `npm run backfill` to seed ~60 days of tasks + git-events so the timeline isn't empty.

Until the GitHub App is configured, the app runs (health, SPA, sign-in screen) but has no
data to sync.

## Notes
- The live app currently deploys from branch `claude/quirky-galileo-4ptdxa` (the default
  `main` did not yet exist). Open a PR and merge to `main`, then point the app's GitHub
  source at `main` for a conventional default-branch deploy.
- Phase status: P0 skeleton, P1 auth+sync, P2 sessions+programmer UI, P3 attribution+flags,
  P4 admin dashboard+timeline, P5 question gate+trends, P6 hardening — all implemented.
