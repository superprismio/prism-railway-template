# Shared Inbox Contract

This is the repo-level drop zone for collaborators and agents.

## Lanes

- `memory/incoming/` -> memory pipeline intake
- `knowledge/incoming/` -> knowledge triage intake

Each lane has:

- `processed/`
- `rejected/`

Do not cross lanes.

## Minimal file contract

Use markdown (`.md`) or JSON (`.json`) with enough provenance to audit source.
Recommended frontmatter keys or JSON fields:

- `source`
- `ts`
- `type`
- `author`
- `bucket_hint` for memory lane items

## Processing rules

- Consumers read only their lane `incoming/`.
- After handling, files move to same-lane `processed/` or `rejected/`.
- Files are never overwritten in place.
