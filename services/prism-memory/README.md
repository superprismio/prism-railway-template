# Prism Memory Service

## Existing installations upgrading from upstream

Syncing this template preserves retained source directories, but does not complete
the Memory cutover for existing volumes. Saved configuration, Site tasks/workflows,
and custom skill overrides need an instance-specific audit. Generated registries
stop updating during normal recap runs; retrieval remains opt-in. JEV is optional.

Ask your agent: **"Use prism-memory-upgrade to audit and repair this installation
after the upstream Memory update."** The [bundled upgrade skill](skills/prism-memory-upgrade/SKILL.md)
preserves sources, configures retrieval refresh, retires confirmed legacy cleanup,
checks custom readers, and verifies the result. It ships through the Memory `/skills`
API; no separate skill install or provider key is needed. An audit request alone
does not change the installation.

## File-backed meeting catalog and retrieval

Current deployment and remaining migration work are tracked in the
[cutover and cleanup runbook](../../docs/runbooks/prism-memory-cutover-cleanup.md).

The catalog implements the core of the
[file-first retrieval rewrite](../../docs/architecture/prism-memory-retrieval-rewrite.md).
It reads processed inbox JSON and writes versioned normalized records, meeting
manifests, and explicit `artifact_of` relationships into a separate directory.
It does not change ingestion, rolling memory, existing APIs, or production jobs.

Run against a snapshot first, from the repository root:

```bash
PYTHONPATH=services/prism-memory/prism_seed/default/code \
  python3 -m community_memory.catalog \
  --root /path/to/snapshot/community \
  --output /path/to/shadow-catalog

PYTHONPATH=services/prism-memory/prism_seed/default/code \
  python3 -m unittest discover -s services/prism-memory/tests -v
```

Readers resolve `current.json` to `generations/<generation>/`. Each immutable
generation contains records (including captured content and original source
references), meeting manifests, relationship files, and an inventory report.
Concurrent builders serialize via a filesystem lock; publication replaces only
the generation pointer. Identical input produces the same generation. Invalid
JSON/payloads or symlink inputs prevent publication and return errors without
replacing the previous generation. Non-JSON files are reported as unsupported.

Explicit session IDs group transcripts and summaries. Legacy Discord voice records
can also recover identity from their HTTPS recording UUID URL; contradictory
session metadata rejects the record. Known recording-workflow source identities
link to the same meeting while preserving separate producer artifacts. Arbitrary
upload/document source IDs do not establish meeting identity. Source IDs identify retries;
different revisions remain available with conflict markers rather than guessing
which summary is authoritative. Legacy records without IDs retain path-based
identities and remain ungrouped. This command does not change existing inbox
deduplication or infer missing session IDs from free text. Display-name participant
lists are observations, not verified person identities.

Current scope: processed inbox JSON only. Raw bucket reconciliation, knowledge
indexing, date-bounded resumable replay, and scheduled Jev enrichment remain later
slices. Trusted internal readers are using retrieval; broader consumer migration
is tracked in the runbook. Use a quiescent snapshot:
locking serializes catalog writers, not edits to source files. The template keeps route registration opt-in; deployment state is instance-specific.

### Trusted internal retrieval

Set `PRISM_SHADOW_CATALOG_ROOT` to the catalog output directory to register these
routes in the existing service. They are absent by default and use existing Memory
read-key authentication. These routes are for trusted internal readers only;
source filters are query selectors, not Site interface authorization. Do not wire
it to handbook-only/public interfaces yet. Current permission changes and source
deletions are not reconciled until a catalog rebuild.

- `GET /meetings`: `source`, `participant`, `start`, `end`, `limit`.
- `GET /meetings/{meeting_id}`: metadata and artifact revision references, with
  competing summaries preserved. Full content is retrieved in bounded passages.
- `POST /retrieval/search`: `query`, optional `source`, `kind`, `participant`,
  `start`, `end`, `meeting_id`, and `limit`.
- `POST /retrieval/context`: `generation`, `record_id`, `revision`, `passage_id`,
  and optional `max_chars`.
- `GET /retrieval/coverage`: observed source/date bounds and explicit limitations.

Date filters require timezone-qualified timestamps and use inclusive start,
exclusive end. Meeting time prefers explicit recording start time, falling back
to the record occurrence timestamp. Participants match display names exactly,
case-insensitively, or stable IDs in new participant-presence metadata; name matches
do not prove identity. Meeting lists group matching artifact revisions by session.

Search uses Unicode lexical tokens and BM25 passage ranking against captured
content. Passages include exact character offsets, record revision, and source
references. Example body: `{"query":"deployment","kind":"meeting_transcript","limit":10}`.
Context must use the returned generation and IDs; if the catalog has changed,
HTTP 409 instructs the client to search again. Missing catalogs return HTTP 503.
Limits default to 20 results (maximum 100), and 8,000 context characters (maximum
32,000). Truncated results are explicitly flagged; cursor pagination is not yet
implemented, so narrow filters rather than treating returned hits as exhaustive.

This is a file-scan baseline, not the proposed persisted inverted index. Search
grouping, phrase/alias expansion, broader source coverage, and upstream
permission/deletion synchronization remain pending. Site scope enforcement exists
on the separate route described below. No new UI is required for cutover.
Install `requirements-test.txt` to run all Python tests, including authenticated
FastAPI route tests. Legacy APIs and recap behavior remain compatible.

### Site-enforced interface retrieval (opt-in)

Site now provides `POST /agent/external-interfaces/{key}/retrieval`. It requires
the normal Site service token **and** that interface's current credential in
`x-prism-interface-credential`, following the existing interface authorization
route. A trusted adapter may forward `x-prism-interface-origin`. This is a
server-to-server route, not a browser endpoint; do not distribute the service
token or Memory credentials to interface clients.

The body is `{"operation":"search","arguments":{"query":"launch"}}`.
Supported operations: `search`, `context`, `meetings`, `meeting`, `coverage`.
Scope is read from the canonical Agent Profile binding on every call; legacy
interaction-profile fallback applies only when no canonical binding exists. Disabled
bindings and missing memory.read capability deny access.
Client-supplied scope fields are rejected. Empty bucket selectors grant no records.
Query filters can only narrow authorized results. This enforcement applies to the
new path only; legacy profile `enforcement: instructions-only` remains an accurate
description of the old chat path, which is not migrated by this change.

Additional configuration for this scoped path:

- Set a dedicated matching `PRISM_RETRIEVAL_SERVICE_KEY` on Site and Memory. It is
  distinct from the legacy Memory read key and is used only for `/retrieval/scoped`.
- Set Memory `PRISM_SHADOW_SOURCE_ROOT` to the authoritative space directory whose
  processed inbox files produced the catalog. Use the snapshot directory in staging.
- Maintain `<source-root>/retrieval/visibility.json` as an authoritative file with
  `denied_record_ids` and `denied_sources` arrays. Initialize explicitly with empty
  arrays only when that reflects intended policy. Update with atomic replacement.
  Missing or malformed policy blocks scoped retrieval with HTTP 503.

Memory intersects the profile's bucket selectors before ranking, counts, meeting
detail, and context expansion. It rereads the visibility file each request and
checks that at least one retained original still normalizes to the indexed record
revision. Deleted or changed originals are excluded immediately, even before a
rebuild. A deny entry suppresses a record even if duplicate retained originals
exist. Scoped responses omit disk references, metadata blobs, and legacy unscoped
artifact URLs; citations use record/revision/passage IDs through the scoped path.

Knowledge-source selectors are transported but **not yet supported by this inbox
catalog**. A knowledge-only profile with no buckets therefore returns no records;
it does not fall back to broad Memory access. Knowledge indexing and source-specific
authorization are a later slice. This path does not automatically detect Discord
message deletions or platform permission changes: adapter synchronization must
update retained files or the deny policy. No existing interface or production
configuration is switched automatically.

### Catalog refresh

`community_memory.catalog_refresh` checks processed inbox content hashes, skips
unchanged input, and atomically publishes a rebuilt generation after additions,
edits, or deletions. It writes only to the designated shadow output directory.
Example one-shot invocation (with the service code on `PYTHONPATH`):

```bash
python3 -m community_memory.catalog_refresh \
  --root /data/prism_seed/community \
  --output /data/prism_seed/community/shadow/retrieval-v2
```

For refresh scheduled by Prism, create an `http-post` task calling
`POST /ops/retrieval/refresh` every five minutes with the ops API key in
`X-Prism-Api-Key` (use a task-runner environment template, never a literal secret).
Use a 150-second task timeout and bounded retries. Keep
`PRISM_SHADOW_REFRESH_SECONDS=0` with this scheduler; the endpoint rejects calls
when the internal timer is enabled. Without `PRISM_SHADOW_CATALOG_ROOT`, refresh
uses `<data_root>/shadow/retrieval-v2` without enabling opt-in retrieval routes.
Create the task disabled, validate a manual run, then enable after review.

For automatic refresh inside the existing service instead, set
`PRISM_SHADOW_CATALOG_ROOT` to that output directory and
`PRISM_SHADOW_REFRESH_SECONDS=60`. Default `0` disables background refresh; enabled
intervals must be at least 30 seconds. Startup runs a first pass immediately in a
subprocess, then polls after each pass. Shutdown terminates the active subprocess.
Local file locks serialize builders, including multiple service workers. This
does not change any collector checkpoint, schedule, recap, or existing reader.

Use ops-authenticated `GET /ops/retrieval/status` for the last check, successful
publication time, counts, generation, errors, and whether automatic refresh is
enabled. `refresh-status.json` preserves status across service restarts. Invalid
input or a missing source directory retains the last good generation and retries
on a later pass. A second content-hash check before publication rejects input
changes observed during construction. This is polling consistency, not a
transactional snapshot of files changed after the final check; the next pass
reconciles those changes. Scoped readers also revalidate current originals.

Change detection is incremental; changed input currently triggers a full derived
generation rebuild. After successful publication, retain the current generation and
the two most recently created other generations. The builder holds its exclusive
build lock; pruning additionally takes an exclusive retention lock. Readers hold
a shared retention lock from pointer resolution through loading immutable records,
so pruning cannot remove a snapshot being loaded. Loaded records remain valid in
the bounded process cache; each request still checks the current pointer and
current source authority. Context requests for a replaced generation return 409.

Successful builds also remove abandoned `.build-*` staging directories. Symlinks
and unrelated directory names are untouched. Failed builds preserve the current
pointer and do not prune. Generation destination symlinks (including broken links)
and non-directory collisions are rejected without replacing them. If pruning fails
after publication, the new generation remains successful and `retention_errors`
records the warning separately from build `errors`. Unchanged refreshes retain that
warning without rebuilding; the next successful build retries cleanup. Retention bounds generation count, not source size;
continue monitoring disk capacity. Deploy the reader and builder changes together
and restart all processes sharing the catalog before enabling this pruning code;
older readers do not participate in the retention lock. Unset the catalog root to
remove opt-in retrieval routes.
No upstream Discord history is fetched by this worker.

Starter FastAPI service for:

- memory retrieval
- knowledge retrieval
- memory artifact browsing
- authenticated ops endpoints
- volume-backed runtime state

Recommended Railway settings:

- mount a persistent volume
- keep the service as the sole owner of that volume
- trigger background work through `/ops/*` from cron services

## Artifact Endpoints

`GET /memory/dates?limit=180` returns the bounded newest-first index of available rolling-memory snapshots. Use it with `GET /memory/date/{date}` for timeline navigation.

Prism Memory serves memory inbox artifacts directly so services can link to durable transcript and summary pages without teaching the site about the memory filesystem layout.

- `GET /artifacts/{id}` returns a human-readable HTML page for a single artifact. This route is intended for links posted back to Discord.
- `GET /api/artifacts` returns an authenticated JSON list. Filters: `type`, `source`, `status`, `limit`.
- `GET /api/artifacts/{id}` returns authenticated JSON metadata, content, and raw payload.
- `GET /api/artifacts/{id}/raw` returns the authenticated raw JSON artifact.

Artifact support covers:

- `inbox/memory/{incoming,processed,rejected}/*.json`, including Discord voice transcripts and summaries written through `POST /memory/inbox`
- `knowledge/kb/docs/**/*.md`
- `knowledge/kb/metadata/**/*.json`
- knowledge inbox files under `inbox/knowledge/*` and `knowledge/kb/triage/*`

## Knowledge Sources

Prism Knowledge now supports file-backed repo sources for deterministic handbook sync.

- Source records live under:
  - `knowledge/sources/<source-id>.json`
- Per-source state, history, and mirror live under:
  - `knowledge/sources/<source-id>/state.json`
  - `knowledge/sources/<source-id>/sync-history/*.json`
  - `knowledge/sources/<source-id>/mirror/`

Current rules:

- only `github` sources are supported
- only `markdown-only` content policy is supported
- sync only ingests `.md` and `.mdx`
- sync scopes to declared or inferred docs roots such as `docs`, `content`, `pages`, or `app`
- sync rebuilds one source partition at a time under:
  - `knowledge/kb/docs/sources/<source-id>/...`
  - `knowledge/kb/metadata/sources/<source-id>/...`

Current endpoints:

- `GET /knowledge/sources`
- `POST /knowledge/sources`
- `GET /knowledge/sources/{source-id}`
- `PATCH /knowledge/sources/{source-id}`
- `POST /knowledge/sources/{source-id}/sync`

Sync semantics:

- per-source deterministic rebuild
- idempotent re-run for the same repo commit
- stable doc identity from `source-id + repo-relative path`
- other knowledge docs and sources are left untouched

The existing knowledge query interface does not change. Source sync feeds the same `knowledge/search` and `knowledge/docs/{slug}` read paths.

## Optional Agentic Ingest

Prism Memory can optionally run an OpenAI-compatible classification pass on memory inbox items before default digest and rolling-memory synthesis.

Intended use:

- keep raw inbox capture deterministic
- enrich selected items with derived metadata
- exclude low-signal assistant/retrieval chatter from default synthesis when configured

Default posture:

- disabled by default
- bundled `space.json` points at `codex-runtime` by default
- bundled `space.json` uses `gpt-5.5` as the default model
- provider target can be swapped to any OpenAI-compatible service

Optional envs:

- `AGENTIC_INGEST_ENABLED=true|false`
- `AGENTIC_INGEST_SCOPE=bot_only|scoped|all`
- `AGENTIC_INGEST_PROVIDER_BASE_URL=...` overrides `space.json`
- `AGENTIC_INGEST_PROVIDER_API_KEY=...`
- `AGENTIC_INGEST_MODEL=...` overrides `space.json`
- `AGENTIC_INGEST_TIMEOUT_SECONDS=30`
- `AGENTIC_INGEST_SCOPED_SOURCES=discord,...`
- `AGENTIC_INGEST_SCOPED_BUCKETS=cohort,...`

Current behavior:

- `enabled=false` does nothing
- scope `bot_only` targets Discord thread/bot-context inbox items based on structural metadata
- scope `scoped` limits enrichment to configured sources and/or buckets
- records classified with `memory_include_default=false` remain stored in raw transcripts but are excluded from default digest generation

## Legacy generated-state compatibility

Normal `memory` and full pipeline runs no longer invoke project/objective builders.
Recaps no longer read throughlines; JSON keeps an empty `current_throughlines` field
for compatibility. Schema v2 causes old daily outputs to rebuild once on the next
normal run when source digests or knowledge events are present. Explicit `state`
commands remain for compatibility, but require builder enablement in config;
project/objective generation and objective enrichment default off.

This section documents the legacy implementation for compatibility and rollback,
not the preferred coordination or evidence path. The
[cutover runbook](../../docs/runbooks/prism-memory-cutover-cleanup.md) tracks retirement
of its active builders and consumers. Existing state writes/rebuilds below remain
implemented but are not recommended for new workflows. Read registry values only
when explicitly needed and report their as-of time; use retained evidence for
current decisions, actions, and ownership.

Legacy routes:

- `GET /state/latest`
- `GET /state/projects`
- `GET /state/signals`
- `GET /state/objectives`
- `GET /state/throughlines`

The first objective-state slice extracts signals from raw records, inbox
metadata, and knowledge source activity, builds active/watching/inactive
objectives, and creates throughlines from explicit hints or optional objective
enrichment suggestions.
Throughlines use the same active/watching windows as objectives, so stale
narratives decay out of open throughline views instead of staying active
forever.

Throughline curation is durable. Ops-authenticated agents can edit, merge, or
hide throughlines through direct state routes; those changes are stored in
`state/curation/throughlines.json` and reapplied during later state runs and
backfills:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/throughlines/website-analytics-cleanup" \
  -d '{"title":"Remove Fathom Analytics","kind":"project","pinned":true}'

curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/throughlines/raidguild-website-maintenance/merge" \
  -d '{"target_key":"website-analytics-cleanup","reason":"Duplicate throughline"}'

curl -fsSL \
  -X DELETE \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/throughlines/noisy-generated-key"
```

Objective enrichment reuses the existing optional agentic ingest provider. When
`AGENTIC_INGEST_ENABLED=true` and the configured provider is reachable, changed
objectives may receive a model-generated title, summary, status explanation,
action items, decisions, open questions, and throughline suggestions. The
provider client supports OpenAI-compatible `/v1/chat/completions` endpoints and
falls back to Codex Runtime `/v1/responses/jobs` when chat completions returns
404. No additional env is required. When the toggle is off or the provider is
unavailable, deterministic state still writes normally.

Operators can rebuild generated state for a date without running the full memory
pipeline:

```bash
curl -fsSL \
  -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/state/run?date=YYYY-MM-DD&force=true"
```

Backfill generated state across recent history:

```bash
curl -fsSL \
  -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/state/backfill?days=60&force=true"
```

State reads support filters such as:

```text
/state/objectives?status=active&externalSystem=portal
/state/signals?anchor=request:26
/state/throughlines?status=active
```

### Retrieval regression and relevance evaluation

See [evaluations/README.md](evaluations/README.md) for synthetic regression tests,
a read-only labeled benchmark runner, metric definitions, and the initial
retained-production-snapshot results. Keep production-derived labels outside the
repository. The benchmark measures retrieval evidence, not generated answers.

### Headless scoped retrieval trial

No UI or new external interface is required to test the Memory API boundary:

```bash
PYTHONPATH=prism_seed/default/code python scripts/scoped_retrieval_trial.py \
  --root /data/prism_seed/community \
  --catalog /data/prism_seed/community/shadow/retrieval-v2
```

This starts a temporary loopback-only API with an ephemeral key and copies retained
`meetings` authority files into a temporary directory. It exercises search, context,
meeting listing/detail, coverage, scope rejection, and warm-cache revocation, then
reports a small five-client HTTP latency benchmark. It deletes the trial server
and temporary files afterward. It does not enable production readers, configure
Site interfaces, or claim to validate upstream permission synchronization. Run it
as a separate process, never inside an existing API process.

Readers cache at most two immutable catalog snapshots with a combined serialized
size budget of 32 MiB per process. Python object overhead is additional; oversized
snapshots are read without caching. Pointer/generation changes select a new entry.
Current source files and visibility policy are never cached. Catalog generation
files must remain immutable; publish edits as a new generation.

Search accepts `query_mode=auto|literal|question`. Auto recognizes common English
question forms. Question mode exposes salient lexical terms and combines their
ranking with the original terms; it does not infer dates, identity, or permissions.
Literal mode preserves existing BM25 behavior. The reader skill describes focused
query planning and separate date-window searches for cross-meeting comparisons.
