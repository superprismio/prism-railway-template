# Prism Memory Path Cleanup

This document scopes the Prism Memory cleanup that removes hardcoded legacy names such as:

- `superprism_poc`
- `raidguild`

The goal is to make the canonical template generic without carrying long-term compatibility code in the main runtime.

## Current Problem

Prism Memory still bakes old naming into:

- bundled starter paths
- bundled starter space slug
- Python CLI defaults
- config fallbacks
- docs and examples
- some runtime path rewriting

This is acceptable for the current live instances only because they already use the old layout. It is not a good permanent shape for the template.

## Migration Strategy

Use a controlled **big-bang migration** for the two current repo-backed instances rather than adding long-lived backward compatibility to the template.

The shape is:

1. refactor the repo to canonical generic names
2. include a one-time migration script in `services/prism-memory`
3. deploy the new code
4. run the migration script on each live instance through Railway CLI
5. verify reads, sources, artifacts, and explorer behavior
6. delete old paths later, only after verification

Important constraint:

- migration should be **copy + rewrite + verify**
- not destructive rename first

That keeps rollback simple.

## Proposed Canonical Names

Use boring names that describe their role:

- bundled starter base dir:
  - `prism_seed`
- bundled starter space slug:
  - `default`

These names separate:

- the bundled seed/runtime scaffold shipped in the repo
- the actual runtime space chosen by `PRISM_API_SPACE`

Examples after cleanup:

- bundled code:
  - `services/prism-memory/prism_seed/default/...`
- live runtime on volume:
  - `<PRISM_API_DATA_ROOT>/prism_seed/<PRISM_API_SPACE>/...`

This keeps the existing runtime model intact while removing branded or POC-specific naming.

## Non-Goals

This cleanup does **not** change:

- public Prism API route shapes
- knowledge query/search contract
- artifact route shapes
- source-sync semantics

It is a storage/config cleanup plus a one-time migration.

## Rollout Order

1. Add this plan document.
2. Implement the refactor in repo.
3. Add a migration script and local dry-run path.
4. Dry-run locally against seeded data.
5. Deploy to the template source project.
6. Migrate the source-backed instance.
7. Migrate the ejected repo-backed instance.
8. Verify both.
9. Update template docs and raw variable guidance if needed.

## Migration Rules

The migration script should:

- be idempotent
- support a `check` mode
- support an `apply` mode
- copy old tree to new tree if new tree does not already exist
- rewrite config path references to canonical names
- rebuild knowledge indexes
- emit a verification summary

The script should **not**:

- delete old data automatically
- rely on operator memory for path rewrites
- silently mutate data without logging actions

## Live Instance Strategy

Current live scope:

- template source project
- one source-backed instance
- one ejected repo-backed instance

Because there are only two real runtime instances and neither has meaningful drift, a one-time migration is lower cost than shipping permanent backward compatibility in the template.

Rollback strategy:

1. keep the old tree intact
2. switch runtime to new tree
3. verify
4. if needed, point runtime back to the old tree and redeploy

## File Groups To Change

### 1. Runtime bootstrap and seeding

- `services/prism-memory/app/main.py`
- `services/prism-memory/Dockerfile`

Expected work:

- rename bundled starter base constant
- rename bundled default space slug
- adjust runtime seed copy/rewrite logic

### 2. Bundled starter config and data tree

- `services/prism-memory/superprism_poc/raidguild/config/space.json`
- bundled tree rename from:
  - `superprism_poc/raidguild/...`
  to:
  - `prism_seed/default/...`

Expected work:

- rename directories
- rewrite path references in `space.json`
- keep collector/state structure unchanged aside from path names

### 3. Community memory defaults

- `services/prism-memory/superprism_poc/raidguild/code/community_memory/config_loader.py`
- `services/prism-memory/superprism_poc/raidguild/code/community_memory/pipeline.py`

Expected work:

- replace hardcoded base defaults
- replace hardcoded fallback space slug
- adjust GitHub backup root default if needed

### 4. Community knowledge defaults

- `services/prism-memory/superprism_poc/raidguild/code/community_knowledge/cli.py`

Expected work:

- replace default `--base`
- replace default `--space`

### 5. Community memory API defaults

- `services/prism-memory/superprism_poc/raidguild/code/community_memory_api/server.py`
- `services/prism-memory/superprism_poc/raidguild/code/community_memory_api/app.py`

Expected work:

- replace default base/space values
- keep route contracts unchanged

### 6. Ops / coordination tools

- `services/prism-memory/superprism_poc/raidguild/code/tools/agent_coord.py`

Expected work:

- replace hardcoded path lists

### 7. Documentation and examples

- `README.md`
- `services/prism-memory/README.md`
- `docs/railway-env-checklist.md`
- `docs/template-deploy-runbook.md`
- `docs/local-vps-deployment.md`
- `services/prism-memory/superprism_poc/raidguild/code/README.md`

Expected work:

- remove `superprism_poc/raidguild` examples
- document canonical names
- document migration script usage for live instances

### 8. Example/reference data

- `docs/knowledge-sync/raidguild-handbook-nextra.json`
- any remaining docs that intentionally or accidentally use the old path names as examples

Expected work:

- only adjust if the old names are being used as storage/path examples
- do not rename content slugs or handbook titles unless there is a separate product reason

## Migration Script Requirements

Add a dedicated script under `services/prism-memory`, for example:

- `services/prism-memory/scripts/migrate_paths.py`

Suggested behavior:

### Check mode

- report whether old tree exists
- report whether new tree exists
- report whether `space.json` still contains legacy prefixes
- report whether knowledge indexes exist

### Apply mode

- create new canonical tree if missing
- copy old tree into canonical location
- rewrite config and metadata path prefixes
- rebuild knowledge index
- emit paths touched

### Verify mode

- confirm health-critical files exist
- confirm knowledge manifest can be rebuilt
- confirm source records are still readable
- confirm artifact listing still works

## Verification Checklist

Run after migration on each instance:

1. `GET /health`
2. `GET /knowledge/search?q=...`
3. `GET /knowledge/docs/{slug}`
4. `GET /knowledge/sources`
5. `GET /api/artifacts`
6. verify one human artifact page
7. verify site `/admin/memory`
8. verify any active Discord summary/artifact flow if that instance uses it

## Railway CLI Execution Model

Run one instance at a time.

Likely flow:

```bash
railway run --project <project-id> --environment <env-id> --service prism-memory -- \
  python scripts/migrate_paths.py --check
```

```bash
railway run --project <project-id> --environment <env-id> --service prism-memory -- \
  python scripts/migrate_paths.py --apply
```

Then verify:

```bash
railway logs --service prism-memory
```

and the relevant HTTP endpoints.

## Recommendation

Do **not** add long-lived compatibility logic to the template for `superprism_poc` and `raidguild`.

Instead:

- refactor the repo to canonical generic names
- migrate the two real instances with a script
- keep the old trees on disk temporarily for rollback
- remove them only after manual verification
