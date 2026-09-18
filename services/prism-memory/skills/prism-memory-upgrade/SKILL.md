---
name: prism-memory-upgrade
description: Audit and repair an existing Prism Memory installation after an upstream template update, including retrieval activation, legacy schedules, and custom reader overrides. Use for Memory upgrade or cutover requests; JEV setup and historical source fetching are separate opt-ins.
---

# Upgrade existing Memory installations

An upstream sync updates service code and bundled skills, not all instance-owned
configuration. Existing data directories are retained. Normal recap processing no
longer updates generated projects/objectives/throughlines; retrieval routes remain
opt-in. Do not mistake frozen legacy state for lost source data.

For an assessment, inspect and report only. For an authorized upgrade/repair,
apply the necessary narrow changes below without requesting duplicate approval.
Never copy another instance's paths, channel IDs, schedules, counts, or credentials.

## Discover and preserve

Use Memory PRISM_API_BASE (fallback PRISM_MEMORY_BASE_URL), with X-Prism-Api-Key
from the appropriate read or ops key. Use Site PRISM_AGENT_API_BASE_URL (fallback
APP_API_BASE_URL) with x-service-token from PRISM_AGENT_SERVICE_TOKEN (fallback
APP_API_SERVICE_TOKEN). Never print credentials or use /admin routes.

1. Read Memory GET /config/status, /config/space, /memory/latest,
   /ops/retrieval/status, and /retrieval/coverage. Distinguish missing routes (404),
   unavailable catalogs, authorization failures, and genuinely empty data.
2. Resolve the actual data root from deployed settings/config path; inspect the
   authoritative processed inbox and raw source directories if service access is
   available. Do not assume the default space slug or /data layout. Record retained
   counts and representative source IDs/dates before changing anything.
3. Read Site GET /agent/tasks, /agent/workflows, /agent/skills. Inspect definitions
   and instruction files of consumers referencing generated state, including open
   requests for legacy cleanup. Names alone do not prove a task is obsolete.
4. Save private rollback copies of config, affected definitions, custom skills, and
   non-secret environment settings. Preserve raw/inbox/knowledge data, collector
   checkpoints, annotations, historical registries, and request history. Never reset
   the volume or replace space.json with the template seed.

## Repair the core cutover

- Read prism-config-admin before config writes. With ops auth and an audit reason,
  PATCH /config/space using:
  {"patch":{"state":{"objectives":{"enabled":false,"enrichment":{"enabled":false}},"projects":{"enabled":false}}}}
  Preserve unrelated settings and instance-specific mappings. These flags do not
  restore the retired automatic state-building pipeline.
- Read prism-task-author and prism-workflow-author before Site definition writes.
  Disable only confirmed generated-registry cleanup tasks/workflows, preserving full
  definitions. Inspect outstanding runs separately; disabling a schedule does not
  stop an already-running request. Do not disable collectors, normal memory runs,
  knowledge sync, or tasks using the separate Action Items service. Do not trigger
  delivery workflows as an upgrade test.
- Restart all Memory readers/builders sharing a catalog on the updated service code
  before refreshing: older readers do not participate in the generation retention
  lock. Keep source files and the last good catalog in place.
- Build from retained processed inbox data using POST /ops/retrieval/refresh with
  ops auth when the internal timer is disabled. Inspect GET /ops/retrieval/status
  for errors, counts, generation, and retention_errors. A successful HTTP response
  alone does not prove a healthy populated catalog. Do not delete catalog generations
  manually to fix an error.
- Enable trusted internal retrieval by setting PRISM_SHADOW_CATALOG_ROOT to the
  verified catalog output on the Memory service and redeploying. The refresh endpoint
  defaults to <data-root>/shadow/retrieval-v2 when no root was configured. Refreshing
  alone does not enable retrieval routes. If deployment access is unavailable,
  report the exact remaining environment change; do not claim cutover is complete.
- Choose one refresh owner. Preserve a healthy existing owner. Otherwise the simple
  service-owned option is PRISM_SHADOW_REFRESH_SECONDS=60. Alternatively use one
  existing/new http-post task for /ops/retrieval/refresh (150-second timeout), keeping
  PRISM_SHADOW_REFRESH_SECONDS=0. Do not enable both or create duplicate schedules.
- Inspect any Site custom prism-api-reader that overrides the bundled skill. Merge
  current retrieval guidance while preserving instance-specific rules, or move those
  rules to a separate skill and update its consumers before removing the override.
  Write custom skills through /agent/skills, never runtime filesystem copies. Verify
  which skill the next runtime invocation actually loads.
- Public/scoped interfaces keep their existing authorized routes. Do not give them
  broad internal retrieval access as a repair. Knowledge/handbook APIs remain separate.

## Verify and report

Check /meetings, a known-source /retrieval/search query, and /retrieval/context using
returned identifiers under an authorized internal read key. Compare coverage against
retained processed sources, not another instance's counts. An empty source installation
can validly have no hits; prove that distinction before calling it healthy.

Repeat refresh through the selected owner with unchanged inputs; expect no new
publication. Verify source/checkpoint preservation and one ordinary recap after
upgrade: schema v2 has no generated throughlines. Do not force a historical recap
rebuild simply to activate retrieval. Check refresh again after service restart.

Save a private receipt: before/after settings, changed task/skill keys, catalog
counts, source IDs tested, skipped items, failed checks, rollback locations, and
remaining manual steps. Re-running this skill should inspect and skip satisfied
steps, not rebuild everything or create new tasks each time.

If data appears missing, reconcile retained raw reports against processed records
first. Catalog refresh does not ingest raw-only history. Determine precise gaps
before a separately scoped re-ingestion; do not repeat Discord searches by default.

JEV credentials, paid provider calls, annotation catch-up, and relationship passes
are not prerequisites for Memory repair. Leave them unconfigured unless requested.

Rollback restores only the changed instance settings/definitions and, if required,
the prior service image. Unsetting the catalog root removes opt-in routes; it does
not restore old automatic state builders. Preserve source data throughout rollback.
