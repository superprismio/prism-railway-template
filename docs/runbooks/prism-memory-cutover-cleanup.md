# Prism Memory: cleanup and full cutover

Status: **internal reader cutover is live; producer retirement is implemented in #90, pending deployment verification.**
Last audited: September 18, 2026, after PRs #88 and #89.
This is the authoritative work list. The architecture specification is the target
contract; notes under `docs/archive/prism-memory-rewrite/` are historical evidence.

## Producer retirement implemented in PR #90

Pending merge/deployment: normal memory runs no longer instantiate or call state
builders. Removed throughline loading, freshness dependencies, narrative and Markdown
sections. Schema v2 retains an empty `current_throughlines` field for JSON compatibility;
old-schema daily output rebuilds once without `--force`. Template builder/enrichment
flags default off; absent objective settings now default off. Registry APIs expose
legacy mode and original as-of dates. The existing view is labeled Legacy state,
shows its snapshot date, and loads only when opened.

Live operations already applied: `weekly-state-cleanup-review` disabled; project,
objective, and enrichment flags off via ops config API. Recent cleanup runs were
terminal. The separate weekly action-items digest reads the Action Items service
and remains enabled. Backups: Site
`/data/custom/memory-retirement-20260918/cleanup-task-before.json`; Memory
`state/retirement-20260918/builder-settings-before.json` under the space root.

Validation: 105 Memory tests and Site tests/typecheck. A Railway source-copy check
rebuilt September 18 using five real digest files, excluded legacy throughlines,
and skipped an unchanged repeat. It did not rewrite the live recap or source data.

**Deployment gate:** after merging, verify the next normal memory run writes schema
v2, no throughline section, and no state-builder activity. Old deployed recap code
can still read the retained throughline file until this branch deploys. The new code
has NOT yet been verified in a live scheduled run.

## What complete means

Existing trusted internal agents use meeting/message retrieval by default. Recaps
use source-backed evidence without maintaining generated projects/objectives/
throughlines. Existing knowledge sync and handbook search continue as their own
supported path. All active consumers have an explicit scope, old state is clearly
historical, and a restart/redeploy reproduces the configuration without handwritten
upload scripts or hidden skill overrides. No new UI, vector database, or language
rewrite is required. JEV, graph traversal, and exhaustive Discord backfill are
optional follow-ups, not conditions for calling the core cutover complete.

## Verified live state

- Merge commits: #88 `ddf3582`; #89 `918ff2c`.
- `prism-memory` enables retrieval with `PRISM_SHADOW_CATALOG_ROOT` pointing at
  `/data/prism_seed/community/shadow/retrieval-v2`.
- Catalog: 3,923 logical records / 3,927 revisions / 128 meetings at the cutover
  checkpoint; these counts will change as ingestion continues.
- `memory-shadow-refresh`: enabled, every five minutes; last tested through the
  normal task runner with HTTP 200. Internal refresh timer remains disabled.
- `memory-run`: enabled, hourly at minute 45. the pre-#90 deployed code calls `run_state()`. This branch removes that call;
  deployment verification remains required.
- Live project/objective generation and enrichment are now explicitly off;
  prior settings are backed up as noted above.
- `weekly-state-cleanup-review`: now disabled; prior schedule Mondays 10:00 UTC.
  Its workflow definition is also disabled; instructions/history are preserved.
- `weekly-action-items-discord-digest`: enabled Mondays 11:00 America/New_York; its workflow
  reads the separate Action Items API, not the generated Memory registry. Do not equate source-backed action items with
  generated objective-registry maintenance.
- Site's custom `prism-api-reader` shadows the bundled skill. Cutover instructions
  were added without removing its instance-specific live Buzz steering behavior.
- Existing public handbook and scoped interfaces were not migrated. Dedicated
  scoped service credentials and authoritative visibility synchronization remain
  rollout work; the localhost trial was not a permanent Site interface integration.
- Two catalog generation directories were present at this audit. The 32-entry guard
  prevents unbounded generation accumulation by stopping refresh, not by pruning.
- JEV is a manual retained-summary experiment. No scheduled provider pass or graph
  reader is enabled. Raw/inbox/knowledge source files remain the evidence authority.

## Ordered cleanup work

### 1. Retire generated-state work as one coherent change — implemented in #90

Owner: Memory pipeline and Site integration maintainer.

- [x] Remove automatic `run_state()` from normal recap generation in
  `services/prism-memory/prism_seed/default/code/community_memory/pipeline.py`.
  Preserve explicit legacy commands during compatibility retirement.
- [x] Remove throughline loading, freshness dependencies, narrative sections, and
  output assumptions from `community_memory/memory.py`; preserve any required
  legacy response field as an explicitly deprecated empty/dated compatibility field.
  Merely disabling builders would otherwise leave stale throughlines in new recaps.
- [x] Default generated project/objective/enrichment builders off in template config,
  then explicitly turn them off in the live config. Verify runtime seed behavior:
  a template edit is not proof that an existing volume was changed.
- [x] Disable `weekly-state-cleanup-review` after inspecting its workflow and recording
  the prior definition. Its workflow is also disabled. Keep `memory-run`, collectors,
  knowledge sync, and refresh enabled.
- [ ] Inspect outstanding request/workflow runs for previously queued legacy cleanup;
  disabling the launcher and workflow is not proof that old requests were canceled.
- [x] Inspect `weekly-action-items-discord-digest` and other workflows for reads of
  generated state. Move any dependent evidence reads to retained meeting summaries.
  Preserve the authorized delivery behavior; a maintenance run must not send messages.
- [x] Remove the default emphasis on objectives/throughlines in the existing Memory
  Explorer and label remaining legacy views with real as-of dates. Existing consumers
  include `services/site/src/components/admin/memory-explorer-workspace.tsx` and
  `/admin/memory/api/state/{objectives,throughlines}` proxies.
- [x] Remove unused throughline recap code and eager builder initialization. Explicit
  legacy commands, curation, and read APIs remain for compatibility, outside the normal
  pipeline. Keep the disabled cleanup definition and its history for rollback.

Done when: a normal scheduled memory run creates a source-backed recap, invokes no
state builder, produces no objective cleanup queue, and all active consumers avoid
claiming frozen registries are current. Tests cover recap output and compatibility.

### Skills and live workflow audit — 2026-09-18

Audited 55 live workflow definitions, all 208 referenced step instruction files
(none missing), and 35 Site custom skills through the agent APIs. The only
workflow referencing generated Memory registry routes was
`weekly-state-cleanup-review-workflow`; it is now disabled via the workflow API,
with unchanged manifest/instructions verified by readback. The separate weekly
Action Items digest queries its own `/api/v1/items` API and remains unchanged.
No delivery workflows were triggered by this audit.

Bundled ops/config skills now separate explicit legacy maintenance from ordinary
Memory/Knowledge operations. Writer guidance preserves upstream meeting metadata
and provenance without promising objective or throughline generation. These
bundled changes take effect after deployment of #90.

The live custom reader now explicitly treats generated registries as historical
compatibility reads and rejects rebuilding them as a retrieval fallback. Its Buzz
safety, channel steering, and found/none_found/unavailable rules are unchanged,
verified by exact suffix comparison and API readback. It remains an intentional
instance override until the separate-skill migration below; do not delete it at
deploy time. Runtime skill caches may retain the prior text for up to five minutes.

Private rollback snapshots are on Site under
`/data/custom/memory-retirement-20260918/`: `audit-workflows.json`,
`audit-skills.json`, `audit-agent-profiles.json`, per-workflow/per-skill audit files,
`workflow-before-retirement.json`, and `reader-before-workflow-audit.json`.
Restore through the corresponding agent APIs, preserving the enabled flag and
existing accountability assignment. These contain instance instructions and must
not be committed into the public template.

### 2. Make the reader/configuration reproducible — same release or immediately next

Owner: runtime skills and deployment maintainer.

- [x] Put trusted-reader endpoint preference in the bundled `prism-api-reader` skill;
  stop recommending generated objectives/throughlines as default evidence.
- [ ] Separate the live custom Buzz-steering behavior into a narrowly named skill,
  update workflows that request it, and retire the same-name reader override only
  after checking skill selection. Never overwrite those steering instructions with
  the generic bundled reader. Confirm runtime loads the intended source after restart.
- [ ] Adopt neutral `PRISM_CATALOG_ROOT` / source-root / refresh naming with temporary
  compatibility aliases for `PRISM_SHADOW_*`. Migrate deployment config and docs in
  the same change; do not rename live paths just for appearance. Remove aliases only
  after caller/config inventory confirms no use.
- [ ] Rename `memory-shadow-refresh` only with its scheduler references, run history,
  receipts, and retry behavior accounted for. Keep exactly one scheduled refresh job.
- [ ] Choose one scheduler: keep the Prism task as the instance default and retain
  the internal timer only as a documented alternative, or remove it after usage audit.
- [ ] Store non-secret deployment requirements and restart checks in the template;
  keep all credentials in existing server/Gateway configuration, never docs or code.

Done when: a clean deployment plus the documented instance configuration reproduces
the reader and refresh behavior, without uploading a patched service tree or executing
one-off skill-patching scripts. Old read endpoints remain a bounded rollback option.

### 3. Close scope and retention debt before broader access

Owner: Site authorization and Memory storage maintainers.

- [ ] Inventory each consumer: internal broad-read agents, external interfaces,
  existing Memory Explorer, knowledge-only handbook, tasks/workflows, artifact links.
  For each, record actual routes, canonical profile, intended scope, and migration decision.
- [ ] Either migrate a narrowly scoped caller through the existing Site-enforced route
  or explicitly leave it on its current supported knowledge path. Do not route it
  through broad read keys merely to call the cutover complete.
- [ ] Synchronize upstream permission changes/deletions into retained source visibility;
  test revocation across search, counts, detail, context, and citations. The temporary
  copied-source trial proves local checks, not upstream synchronization.
- [ ] Replace the generation-count stop guard with reader-safe retention and cache
  invalidation, using a lock/lease design or another tested scheme. Retain the active
  generation and a documented rollback set; clean abandoned builds safely.
- [ ] Expose freshness/error/guard status in existing operations reporting. On guard
  exhaustion, preserve evidence and last good generation; do not silently serve stale
  retrieval as current or delete files under readers.
- [ ] Decide the deprecation window for unused broad/legacy APIs only after usage
  inventory. Existing knowledge and artifact APIs are NOT automatically obsolete.

Done when: each supported consumer has a tested authorization path, no stale-data
permission bypass remains, and normal refresh cannot require recurring manual disk
cleanup. No requirement to build a new interface or visualization.

### 4. Fill retained-history gaps, then optional enrichment

- [ ] Reconcile raw files/transcripts against processed records; record exclusions and
  unknown gaps. Reuse existing meeting summaries rather than resummarizing by default.
- [ ] Backfill bounded Discord windows, starting with the proposed last 90 days and
  configurable Raids-category discovery. Verify history traversal capability first.
  Use source IDs, independent cursors, idempotent import, and coverage receipts.
  Search result counts are not proof of exhaustive coverage. Do not move live collector
  checkpoints or historical `latest` backward; missing audio cannot be recovered.
- [ ] Refresh the catalog and verify counts/evidence on new imports; keep missing or
  inaccessible history explicit. This work does not block the trusted reader already live.
- [ ] If retaining JEV, turn the bounded pilot into one optional changed-revision task
  with Gateway leases, budgets, cache keys, provenance, abstention, and stale-annotation
  invalidation. Otherwise move the pilot into archived experiment tooling after inventory.
  Never leave an experimental graph presented as authoritative production state.

## Code/artifact disposition

| Artifact | Disposition and removal condition |
| --- | --- |
| `catalog.py`, `catalog_refresh.py`, `retrieval.py`, retrieval routers | Keep: active core. Remove preview wording, not functional boundaries. |
| `retrieval_eval.py`, synthetic tests, evaluation README | Keep: reproducible validation. Private corpus and labels stay outside Git. |
| `scripts/scoped_retrieval_trial.py` | Keep: single canonical headless smoke tool; temporary source copies/key/listener self-clean. |
| `relationship_pilot.py` and its tests | Keep explicitly experimental until optional enrichment decision; not wired into core reader. |
| `project_state.py`, `objective_state.py`, related state routes/UI | Migrate active consumers first (step 1), then remove unused implementation together. |
| Legacy rolling memory, digests, knowledge sync/search, artifact routes | Keep supported until an actual consumer migration makes a specific path obsolete. |
| Five early implementation/validation notes | Archived under `docs/archive/prism-memory-rewrite/`; not operating instructions. |
| Old `work/memory-task-deploy` upload tree and duplicate remote trial scripts | Remove: superseded by merged source and canonical smoke script. |
| One-off `work/apply_reader_cutover.py` | Remove: non-idempotent replay helper; keep the cutover receipt and remote rollback backup. |
| Copied evaluation corpus, labeled suites, recorded JEV results | Retain privately for reproducibility; establish a retention date separately. Never publish them as fixtures. |
| Portal Artifacts visual demo and exported video | Separate project/deliverable; not Memory cleanup targets. |
| Live source files, activity log, collector checkpoints, current catalog, rollback skill backup | Preserve. These are evidence/operational state, not disposable build artifacts. |

## Cleanup completed in this pass

- Archived five historical checkpoint documents and linked current documentation
  to this runbook. Corrected obsolete preview and authorization descriptions.
- Aligned the bundled reader with trusted retrieval; legacy generated registries
  are now documented as compatibility reads rather than default evidence.
- Removed 113 local scratch files (about 5.65 MB): the obsolete upload tree, duplicate
  remote trial scripts, non-idempotent skill-patching helper, and redundant base64
  catalog transfer. The extracted corpus and evidence labels remain available.
- The initial documentation-only pass passed 100 Memory tests and did not alter
  live settings. The subsequent producer-retirement changes and operations are
  recorded at the top of this runbook; source data and public interfaces remain intact.

## Rollback and closeout

For reader rollback, restore the prior Site custom skill from
`/data/custom/memory-cutover-20260918/reader-before.md` via the skill API and unset
Memory's `PRISM_SHADOW_CATALOG_ROOT`. Allow skill caches to expire (default five
minutes). For producer rollback, retain the pre-change task/config definitions and
restore those specific settings; do not rewind source data or collector checkpoints.

Close this runbook only after steps 1–3 are checked off with deployment/test evidence.
Track backfill and JEV separately. Record commits, task keys, configuration changes,
verification dates, and any deliberately retained compatibility endpoint here. The
cleanup PR itself does not claim that producer retirement or scoped rollout is done.
