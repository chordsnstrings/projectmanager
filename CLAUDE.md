# CLAUDE.md — Cadence

Session-based engineering-visibility tool for a remote dev team. **Sessions are the clock,
git is the source of truth, tasks come from the repos, and the manager gets a granular
timeline + a question gate.** Two roles: `admin` (sees everyone) and `dev` (sees only self).

## The model in one paragraph
A **task** is a unit of work that already exists in git (assigned open Issue, or open
PR / active branch). A **session** is a manually started/stopped timer attached to exactly
one task — the only clock and presence signal. A **git-event** (commit, PR opened/merged,
review) is observed truth, ingested by webhook. Cadence's value is the **diff between
declared sessions and observed git**, surfaced as **flags**. Activity type
(coding/debugging/research/agent/review) is inferred from git, optionally corrected by one
tap. Estimates come from a label/Projects field/in-tool.

## Stack
- **Backend:** Node 20 + TypeScript, **Fastify**, **Prisma**, **Octokit**
  (`@octokit/app`, `@octokit/rest`, `@octokit/webhooks`).
- **Frontend:** **React + Vite + TypeScript + Tailwind** (design tokens below). Timeline /
  session UI are custom absolute-positioned components — no heavy Gantt library.
- **DB:** PostgreSQL 17 (DigitalOcean Managed).
- **Auth:** server-side session in a signed, httpOnly cookie after GitHub OAuth. No browser JWTs.
- **One repo, one deployable:** Fastify serves the API *and* the built SPA (`apps/web/dist`).

## Monorepo layout (npm workspaces)
```
apps/server/     # Fastify API + webhook handler + serves ../web/dist
apps/web/        # React + Vite SPA
packages/db/     # Prisma schema + generated client + migrations  (@cadence/db)
packages/shared/ # shared TS DTO types used by server + web        (@cadence/shared)
scripts/         # (entrypoints compiled into apps/server/dist/scripts)
.do/app.yaml     # DigitalOcean App Platform spec
```
Backend packages compile to CommonJS via `tsc`; web is bundled by Vite. Build order:
shared → db (prisma generate) → web → server. Root scripts: `build`, `start:server`,
`migrate:deploy`, `reconcile`, `backfill`, `dev`, `typecheck`, `test`.

## Conventions (enforce everywhere)
- All timestamps `timestamptz` in **UTC**.
- **Soft-delete** via `deletedAt` on every table; queries must respect it.
- Durations stored as integer **seconds/minutes**, never floats.
- **Every list endpoint paginated.**
- Webhook handlers **idempotent** — dedupe on GitHub delivery id / object id.
- Verify `X-Hub-Signature-256` (constant-time) **before** parsing webhook bodies.
- Flags are **never auto-blocking**; the question gate (`blocksNext`) is a workflow gate.
- Resolve commit authors by `githubId` first, then any known `UserEmail`.

## Data model (Prisma — see packages/db/prisma/schema.prisma)
Enums: Role, TaskSource, TaskStatus, ActivityType, ActivitySource, GitEventType, FlagType,
FlagStatus, QuestionStatus. Models: User, UserEmail, Installation, Repo, Task, Session,
ActivitySegment, GitEvent, Flag, Question. `actualMinutes` is computed (sum of a task's
sessions), not a column. `active-elapsed` = union of session intervals; `task-hours` = sum
(may exceed elapsed under concurrency; never add overlaps).

## Design tokens (§9 — dark "engineering instrument")
```
bg #15171c  panel #1c1f26  surface #21252e  surface2 #272c36
text #e8eaed  text2 #9aa0aa  text3 #686d77
border rgba(255,255,255,.08)  border2 rgba(255,255,255,.16)
brass #c8a96a (accent, sparing)  danger #ef5b5b  success #5bc07a
activity: coding #2bb68c · debugging #f0a93b · research #4c9aea · agent #9a8cf0 · review #8a909b
font: system-ui sans for chrome; ui-monospace/Menlo for ALL data (times, repos, numbers, branches)
radius 8–14px · 0.5px hairlines · flat (no gradients/shadows) · weights 400/500/600
signature: 3px left edge on a running row, colored by inferred activity
```
The two HTML mockups (`programmer_ui_git.html`, `programmer_day_timeline.html`) are the
canonical visual reference — match pixel-for-feel.

## Build phases (gate on acceptance; see /root/.claude/plans/cadence-build-agile-puppy.md)
P0 skeleton+deploy · P1 auth+GitHub App+sync · P2 sessions+programmer UI · P3 attribution+
flags+reconcile · P4 admin dashboard+timeline · P5 question gate+trends · P6 hardening.

## Local dev
- Throwaway Postgres for migration testing (Postgres 17 in prod). `DATABASE_URL` per `.env`.
- `npm run migrate:dev` to create/apply migrations; `npm run build` then `npm run start:server`.
- GitHub App + OAuth need real credentials; without them, GitHub paths are exercised via
  unit/integration tests with signed payloads + mocked Octokit.

## Tunables (env, defaults in code)
`IDLE_MINUTES=90`, `MAX_OPEN_HOURS=8`, `OVERRUN_FACTOR=1.5`.
