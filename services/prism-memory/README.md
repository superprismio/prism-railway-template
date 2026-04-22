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
