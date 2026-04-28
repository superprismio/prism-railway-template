# Prism Memory Service

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
- provider target can point at `codex-runtime` or any OpenAI-compatible service

Optional envs:

- `AGENTIC_INGEST_MODE=off|bot_only|scoped|all`
- `AGENTIC_INGEST_SCOPE=bot_only|scoped|all`
- `AGENTIC_INGEST_PROVIDER_BASE_URL=http://codex-runtime.../v1`
- `AGENTIC_INGEST_PROVIDER_API_KEY=...`
- `AGENTIC_INGEST_MODEL=...`
- `AGENTIC_INGEST_TIMEOUT_SECONDS=30`
- `AGENTIC_INGEST_SCOPED_SOURCES=discord,...`
- `AGENTIC_INGEST_SCOPED_BUCKETS=cohort,...`

Current behavior:

- mode `off` does nothing
- scope `bot_only` targets Discord thread/bot-context inbox items based on structural metadata
- scope `scoped` limits enrichment to configured sources and/or buckets
- records classified with `memory_include_default=false` remain stored in raw transcripts but are excluded from default digest generation
