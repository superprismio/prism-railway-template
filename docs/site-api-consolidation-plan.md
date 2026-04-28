# Site/API Consolidation Plan

This document tracks the planned consolidation of `services/site` and `services/api` into a single Next.js web app.

## Goal

Move the current Express-backed app/API surface into the Next.js app so the deployed stack removes one service:

- keep: `site`, `prism-memory`, `codex-runtime`, `discord-adapter`, cron services
- remove later: `api`

This is a staged refactor, not a rewrite.

## Constraint

There are active community deployments on the current split topology. The consolidation must be evaluated for:

- env var migration cost
- volume / SQLite coupling
- stateful upgrade overhead
- template impact

The immediate purpose of this branch is to learn the upgrade cost before merging anything topology-changing.

## First Attempt Findings

We tried the smallest useful additive slice:

- read admin board data directly from `site`
- reuse `services/api/src/repository.ts` and `services/api/src/config.ts`
- keep the standalone `api` service alive

That direct import approach did **not** build cleanly in Next.

### Build blockers from the attempt

1. `services/api` is authored under `NodeNext` conventions with `.js` import suffixes in TypeScript source.
2. `services/site` uses Next/Bundler resolution.
3. Importing `services/api/src/repository.ts` from `site` caused Next build failures like:
   - `Module not found: Can't resolve './config.js'`
   - `Module not found: Can't resolve './db.js'`
   - `Module not found: Can't resolve './home-modules.js'`
   - `Module not found: Can't resolve './site-content.js'`
4. Even for read-only endpoints, `site` would also need the `better-sqlite3` runtime path and the same data root as `api`.

### Operational implication from the attempt

Even the smallest read-only consolidation slice implies that `site` would need:

- the app DB/data root
- the same SQLite file access as `api`
- the same admin password config
- the same setup-status dependency env

That means this is not “just route code movement.” It is also:

- a data-root move
- a service env move
- likely a volume move for Railway

## Recommended Architecture Change Before Route Porting

Do **not** import `services/api/src/*` directly into `services/site`.

Instead, first extract reusable backend logic into a shared package, for example:

- `packages/app-core`

That shared package should own:

- config loading
- DB bootstrap
- repository/data access
- session helpers
- service-layer logic for target apps, target environments, change board, executions, and setup status

Then:

- `services/api` can keep using the shared package during transition
- `services/site` can add Next route handlers against the same shared package

This avoids fighting bundler/module-resolution differences between the two service codebases.

## Current Branch Progress

This branch now includes the first additive implementation step:

- extracted a new shared package: `packages/app-core`
- copied the API-side stateful backend modules needed for read-heavy admin views:
  - config
  - SQLite bootstrap
  - migrations
  - repository access
  - home-module and site-content helpers
- added a small shared read service for:
  - admin board snapshot
  - admin setup status
- updated `site` so it can opt into local backend reads with:
  - `SITE_USE_LOCAL_APP_API=true`

Current scope of the local read mode:

- `getAdminBoardData()`
- `getAdminWorkspaceData()`
- Memory explorer admin access checks

Writes still go through the standalone `api` service. This is deliberate. It gives us a concrete migration surface without forcing a writer cutover.

### What this proved

1. The shared-package extraction is viable.
2. Next can build against the extracted backend package when:
   - `@prism-railway/app-core` is a workspace package
   - `site` transpiles that package
   - `better-sqlite3` is treated as a server external
3. The real coupling is exactly what we suspected:
   - `site` needs the app DB/data root to do meaningful local reads
   - `site` needs `ADMIN_PASSWORD`
   - `site` needs the same healthcheck dependency env used by setup status

### What this did not prove yet

- local write parity for change requests, target apps, or target environments
- session-auth parity with the Express API
- internal service-token parity for machine callers
- safe live migration of the SQLite writer from `api` to `site`

### Immediate migration implication

For a real instance upgrade, local read mode alone already implies that `site` must be able to see the app SQLite file. On Railway, that means either:

- attaching the current app volume to `site`, or
- keeping `api` mounted and continuing to proxy reads through it

That is the main operational cost driver for the consolidation.

## Migration Checklist

### 1. Stabilize current split stack

- keep current template unchanged for active users
- continue bugfixes on the split topology
- do not remove `api` yet

### 2. Extract shared backend package

- create `packages/app-core`
- move framework-neutral backend code out of `services/api/src`
- keep HTTP transport thin in Express

### 3. Port additive Next route slices

Start with read-heavy admin routes:

- `GET /api/admin/setup/status`
- `GET /api/admin/target-apps`
- `GET /api/admin/target-environments`
- `GET /api/admin/change-board/requests`

Keep the existing `api` service alive while this happens.

### 4. Identify env migration

Inventory `api`-owned env and classify:

- move to `site`
- keep on other services
- delete
- rename

Likely moved env includes:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `COMMUNITY_PROVIDER`
- `PRISM_AGENT_DATA_ROOT`
- `PRISM_MEMORY_BASE_URL`
- `CODEX_RUNTIME_BASE_URL`
- `INTERNAL_SERVICE_TOKEN`

### 5. Identify volume/data-root migration

If `site` takes over app/API storage concerns, it will need:

- the SQLite DB path
- any app data root currently owned by `api`

This is a real deployment concern for Railway instances.

### 6. Port auth/session ownership

Move from Express to Next route handlers:

- session cookie issuance
- session validation
- admin password fallback
- internal service-token auth

### 7. Repoint internal callers

After parity exists:

- `codex-runtime`
- `discord-adapter`
- any admin route proxies

Move them from `api` to `site`

### 8. Only then remove `api`

Do not remove the `api` service until:

- route parity is proven
- instance upgrade steps are rehearsed
- rollback is clear

## Live Upgrade Concerns

Because current deployments are stateful, consolidation is not just a fresh-template concern.

Existing instances may need:

- a `site` env expansion
- a `site` volume/data-root change
- repointed internal URLs
- coordinated redeploy ordering

This should be treated as a staged upgrade, not a casual template tweak.

## Current Recommendation

Build the consolidation in a branch and shared package first.

Do not merge topology changes until:

1. the shared package exists
2. additive Next route parity is proven
3. the env/volume migration checklist for the current live communities is explicit
