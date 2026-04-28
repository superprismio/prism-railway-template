---
name: prism-config-admin
description: Inspect and update Prism Memory space configuration, then run backfill or memory/knowledge ops through the Prism Memory API. Use when a user wants to configure Prism behavior by chat instead of editing `space.json` manually.
---

# Prism Config Admin

Use this skill for chat-driven Prism Memory configuration and operational runs.

## Required auth

Send:

```text
X-Prism-Api-Key: <ops-key>
```

This skill requires an ops-capable Prism key.

## Core workflow

1. Read current config first with `GET /config/space`.
2. Prefer `PATCH /config/space` for narrow changes.
3. Use `PUT /config/space` only when replacing the full config intentionally.
4. After config changes, tell the user exactly what changed.
5. Only run backfill or memory/knowledge ops when the user asks for it or when the change clearly requires recomputation.

## Endpoints

- Read space config:
  `GET /config/space`
- Read config status:
  `GET /config/status`
- Patch space config:
  `PATCH /config/space`
- Replace space config:
  `PUT /config/space`
- Run normal memory pipeline:
  `POST /ops/memory/run`
- Run memory backfill:
  `POST /ops/memory/backfill?days=...&force=true`
- Run knowledge pipeline:
  `POST /ops/knowledge/run`

## Rules

- Do not guess config shape without reading current config first.
- Prefer minimal recursive patches over full replacements.
- When changing optional features, preserve unrelated config.
- For agentic ingest:
  - default to `mode=off`
  - use `scope=bot_only` for first experiments
  - treat provider settings as optional unless the user explicitly wants it enabled now
- For backfills:
  - explain blast radius in days
  - default to the narrowest day range that satisfies the request

## References

- Load [references/endpoints.md](references/endpoints.md) for request patterns.
- Load [references/examples.md](references/examples.md) for safe patch examples.
