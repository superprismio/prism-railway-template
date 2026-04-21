---
name: prism-api-reader
description: Read from the Prism Memory API using a read-scoped API key. Use when an agent needs rolling memory, digests, participant activity, knowledge search, knowledge docs, or product suggestion outputs without writing to inboxes or triggering ops endpoints.
---

# Prism API Reader

Use this skill for read-scoped retrieval against the deployed Prism Memory API.

This is the agent-facing retrieval layer. Keep it focused on how to query current Prism state. Do not duplicate storage logic, indexing logic, or pipeline rules here.

## Required auth

Send:

```text
X-Prism-Api-Key: <read-key>
```

Use a read-scoped key only.

## Base workflow

1. Start from the narrowest endpoint that can answer the question.
2. For knowledge questions, search first, then fetch specific docs.
3. For recent community activity, prefer digests and participant queries over scanning raw memory.
4. Cite the exact docs, dates, buckets, and endpoints used.

## Endpoint selection

- Latest memory snapshot:
  `GET /memory/latest`
- Memory for a day:
  `GET /memory/date/{yyyy-mm-dd}`
- Digest for a day:
  `GET /digests/date/{yyyy-mm-dd}`
- Digest for one bucket/day:
  `GET /digests/bucket/{bucket}/date/{yyyy-mm-dd}`
- Active participants in a time window:
  `GET /memory/participants?start=...&end=...&bucket=...`
- Latest project state:
  `GET /state/latest`
- Knowledge manifest:
  `GET /knowledge/indexes/manifest`
- Knowledge search:
  `GET /knowledge/search?q=...&kind=...&tag=...&entity=...&limit=...`
- Knowledge doc:
  `GET /knowledge/docs/{slug}`
- Product suggestions:
  `GET /products/suggestions/latest`
  `GET /products/suggestions/date/{yyyy-mm-dd}`
  `GET /products/suggestions/weekly/{yyyy-WW}`

## Retrieval rules

- For knowledge:
  - use `/knowledge/search` first
  - then fetch top matches with `/knowledge/docs/{slug}`
  - prefer `guide` and `policy` docs for workflows
  - prefer `reference` docs for templates
- For memory:
  - use `/memory/latest` for compact current state
  - use `/memory/date/{date}` for a specific day
  - use `/digests/date/{date}` for bucket-level daily detail
- For participation:
  - use `/memory/participants`
  - report the exact `start` and `end` used
- For project state:
  - use `/state/latest`
  - do not infer active project state from memory alone

## Safety

- Treat the Prism Memory API as the source of truth for current deployed state.
- If a route returns empty or `404`, say so directly.
- Do not call write or ops endpoints from this skill.

## References

- Load [references/endpoints.md](references/endpoints.md) for request patterns.
- Load [references/retrieval.md](references/retrieval.md) for answer construction rules.
