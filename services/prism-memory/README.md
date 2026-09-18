# Prism Memory Service

## Experimental shadow meeting catalog

The opt-in catalog is the first slice of the
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
indexing, date-bounded resumable replay, Jev, and production cutover remain later
slices. Use a quiescent snapshot:
locking serializes catalog writers, not edits to source files. Existing readers
do not consume this catalog yet.

### Read-only retrieval preview

Set `PRISM_SHADOW_CATALOG_ROOT` to the catalog output directory to register these
routes in the existing service. They are absent by default and use existing Memory
read-key authentication. This preview is for trusted internal readers only;
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
grouping, phrase/alias expansion, broader source coverage, Site policy proxies,
permission/deletion reconciliation, and public UI integration are still pending.
Install `requirements-test.txt` to run all Python tests, including authenticated
FastAPI route tests. Existing production readers and recap behavior are unchanged.

### Site-enforced interface retrieval (opt-in)

Site now provides `POST /agent/external-interfaces/{key}/retrieval`. It requires
the normal Site service token **and** that interface's current credential in
`x-prism-interface-credential`, following the existing interface authorization
route. A trusted adapter may forward `x-prism-interface-origin`. This is a
server-to-server route, not a browser endpoint; do not distribute the service
token or Memory credentials to interface clients.

The body is `{"operation":"search","arguments":{"query":"launch"}}`.
Supported operations: `search`, `context`, `meetings`, `meeting`, `coverage`.
Scope is read from the current authenticated interaction profile on every call;
client-supplied scope fields are rejected. Empty bucket selectors grant no records.
Query filters can only narrow authorized results. This enforcement applies to the
new path only; legacy profile `enforcement: instructions-only` remains an accurate
description of the old chat path, which is not migrated by this change.

Additional configuration for this experimental path:

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

### Live-file shadow refresh

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
uses `<data_root>/shadow/retrieval-v2` without enabling preview reader routes.
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
generation rebuild. Old generations are retained for rollback and are not pruned
automatically. Monitor disk consumption before enabling prolonged refresh; a
reader-safe generation retention policy is still pending. Stop the worker by
setting the interval to `0`; unset the catalog root to remove preview read routes.
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

## Generated State

Prism Memory exposes generated state for source-agnostic coordination:

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
