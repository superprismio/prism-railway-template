---
name: prism-api-ops
description: Run privileged Prism Memory ops endpoints using an ops-scoped API key. Use when an agent is explicitly authorized to trigger memory or knowledge processing, backfills, or other maintenance actions against the live Prism deployment.
---

# Prism API Ops

Use this skill only with an ops-capable Prism Memory API key and explicit authorization.

This skill triggers existing pipeline operations through the API. It does not reimplement the pipeline inside the agent runtime.

## Required auth

Send:

```text
X-Prism-Api-Key: <ops-key>
```

## Ops endpoints

- Memory run:
  `POST /ops/memory/run`
- Memory backfill:
  `POST /ops/memory/backfill?days=30&force=true`
- Knowledge promote only:
  `POST /ops/knowledge/promote`
- Knowledge validate only:
  `POST /ops/knowledge/validate`
- Knowledge index only:
  `POST /ops/knowledge/index`
- Knowledge full run:
  `POST /ops/knowledge/run`

## Legacy registry maintenance (explicit opt-in only)

The generated project/objective/throughline registry is retired from normal memory
processing. Leave its builders and cleanup schedules disabled. Use these
compatibility routes only for explicit legacy-registry maintenance or rollback;
they do not backfill source history or refresh the retrieval catalog.
Never enable builders just because a registry is empty or stale.

- State rebuild:
  `POST /ops/state/run?date=YYYY-MM-DD&force=true`
- State backfill:
  `POST /ops/state/backfill?days=60&force=true`
- Edit throughline curation:
  `PATCH /state/throughlines/{throughline_key}`
- Merge duplicate throughlines:
  `POST /state/throughlines/{throughline_key}/merge`
- Hide/delete a generated throughline:
  `DELETE /state/throughlines/{throughline_key}`

## Usage rules

- Use `memory.run` for normal collection, digest, memory, and seed processing.
- Use `memory.backfill` only when explicitly asked to recompute historical windows.
- Only for explicitly requested legacy maintenance, use `state.run` to rebuild generated project/objective/signal/throughline state for one day without running digest, memory, or seeds.
- Only for explicitly requested legacy maintenance, use `state.backfill` to rebuild generated state over recent history without deleting raw records.
- Only for explicitly requested legacy maintenance, use throughline curation routes when an authorized agent needs to rename, merge, pin, archive, classify, or hide generated throughlines. Do not write generated state files directly.
- Use `knowledge.run` after writing new knowledge inbox docs that should become searchable now.
- Prefer the narrowest endpoint that solves the task.

## Safety

- Do not run backfills casually.
- State the exact date or day range before triggering historical recomputation.
- Report the returned `operation`, `exit_code`, and any `stdout` summary.
- If an ops endpoint fails, surface the returned error body directly instead of paraphrasing loosely.

## References

- Load [references/endpoints.md](references/endpoints.md) for common request patterns.
