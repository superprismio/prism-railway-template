# Memory Explorer UI

The Memory Explorer is an admin-only surface for browsing Prism Memory from the site app.

It lives outside the change board at:

```text
/admin/memory
```

The change board remains focused on change requests, target apps, execution records, and Codex runs. Memory exploration is a related operator workflow, but it needs its own route because it has different layout needs: artifact tables, document previews, source status, raw payload inspection, and future retrieval or graph tools.

## Purpose

The first Memory Explorer POC lets admins:

- browse Prism Memory artifacts
- filter and sort returned artifacts
- inspect artifact content and raw JSON payloads
- search indexed knowledge docs
- inspect knowledge doc content and metadata
- review registered knowledge sources and sync status

The POC is intentionally read-only.

`Ask Memory` and graph visualization are deferred until the team has tested the base explorer and reviewed the metadata/provenance gaps.

## Current Shape

Implemented in `services/site`.

Primary page:

- `services/site/src/app/admin/memory/page.tsx`

Client workspace:

- `services/site/src/components/admin/memory-explorer-workspace.tsx`

Site-side Prism Memory helper:

- `services/site/src/lib/prism-memory.ts`

The existing admin board links to the explorer with a `Memory` action in the admin header.

## Auth And Proxy Model

The browser does not call Prism Memory directly.

Instead, the site exposes admin-only route handlers under:

```text
/admin/memory/api/*
```

Those handlers:

- reuse the existing admin password cookie flow
- validate admin access through the API
- call Prism Memory server-side
- send `X-Prism-Api-Key` from server env
- return Prism Memory JSON to the browser
- avoid exposing Prism Memory keys or internal base URLs

This keeps the first POC scoped to the site app while preserving the existing `site` and `api` split.

If the explorer becomes a stable backend contract, the proxy routes can move into `services/api` later.

## Implemented Proxy Routes

Current site route handlers:

- `GET /admin/memory/api/artifacts`
- `GET /admin/memory/api/artifacts/:id`
- `GET /admin/memory/api/knowledge/search`
- `GET /admin/memory/api/knowledge/docs/:slug`
- `GET /admin/memory/api/knowledge/sources`

They proxy these Prism Memory endpoints:

- `GET /api/artifacts`
- `GET /api/artifacts/{id}`
- `GET /knowledge/search`
- `GET /knowledge/docs/{slug}`
- `GET /knowledge/sources`

## Required Env

Set on `site`:

```text
PRISM_MEMORY_BASE_URL=http://127.0.0.1:8788
PRISM_API_READ_KEY=replace-me
```

Fallback:

```text
PRISM_API_KEY=replace-me
```

`PRISM_API_READ_KEY` is preferred when the deployment has split Prism Memory read, write, and ops keys. `PRISM_API_KEY` keeps older single-key deployments working.

### Existing Instances And Template Impact

This POC adds new `site`-side Prism Memory wiring.

Existing instances or older template deploys need at least:

```text
PRISM_MEMORY_BASE_URL=http://<reachable-prism-memory>
```

For auth:

- preferred: `PRISM_API_READ_KEY`
- fallback: existing `PRISM_API_KEY`

So the new hard requirement is the Prism Memory base URL on `site`. The read key is only a new requirement when the deployment has already split Prism Memory auth by scope.

The site still needs the normal admin/API env:

```text
API_INTERNAL_BASE_URL=http://127.0.0.1:4010
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4010
```

## Artifact Explorer

The artifact explorer reads from `GET /api/artifacts`.

Current controls:

- category
- status
- source
- type
- limit
- local text search over returned rows
- sort by newest, oldest, source, type, or content length

Current table fields:

- created
- filename
- preview
- source
- type
- status
- content length

Selecting a row loads `GET /api/artifacts/{id}` and shows:

- status/category/source badges
- source link when available
- content preview
- raw payload JSON

## Knowledge Search

The knowledge search view reads from `GET /knowledge/search`.

Current controls:

- query
- kind
- tag
- entity

Search results show:

- title
- slug
- kind
- summary
- tags

Selecting a result loads `GET /knowledge/docs/{slug}` and shows:

- full content when available
- tags
- source link when available
- raw doc metadata

## Knowledge Sources

The sources view reads from `GET /knowledge/sources`.

Current table fields:

- label
- repo URL
- branch
- kind
- status
- doc count
- last synced time

Selecting a source shows:

- file count
- doc count
- repo and branch
- last synced commit
- last synced time
- docs roots
- current sync error when present
- raw source JSON

Source creation, editing, and sync controls are not part of the POC.

## Current Limitations

The POC depends on the existing Prism Memory read endpoints.

Known limitations:

- artifact full-text search is local over the returned page, not a server-side search
- artifact pagination is limited to the current `limit` behavior
- date-range filters are not implemented yet
- source/type dropdowns are derived from the currently returned artifacts
- graph relationships are not exposed by Prism Memory yet
- `Ask Memory` is not implemented yet
- the explorer is admin-password gated, not role-scoped beyond the current admin model

These are acceptable for the first POC because the immediate goal is to validate the route, proxy boundary, and operator browsing workflow.

## Validation

The site workspace passes:

```bash
npm run typecheck --workspace @prism-railway/site
npm run build --workspace @prism-railway/site
```

The production build includes:

- `/admin/memory`
- `/admin/memory/api/artifacts`
- `/admin/memory/api/artifacts/[id]`
- `/admin/memory/api/knowledge/search`
- `/admin/memory/api/knowledge/docs/[...slug]`
- `/admin/memory/api/knowledge/sources`

## Next Steps

Near-term:

- test the explorer with real Prism Memory volume data
- confirm whether artifact filters are enough for operators
- add date-range filtering if the artifact set is large
- decide whether artifact search should move into Prism Memory
- add stable pagination or cursors if needed
- add a clearer link from settings/setup into `/admin/memory`

After team review:

- add `Ask Memory` as an explicit retrieval workflow over selected artifacts/docs
- require citations back to artifact IDs, doc slugs, and source URLs
- keep Codex context bounded instead of letting it crawl all memory by default
- add graph-ready provenance fields where missing
- prototype a graph endpoint before building a graph canvas

Possible graph endpoint shape:

```text
GET /api/graph?category=memory&source=discord-voice&limit=500
```

Possible `Ask Memory` route shape:

```text
POST /admin/memory/api/ask
```

The recommended next product step is to use the POC with real data before adding either graph visualization or question-answering.
