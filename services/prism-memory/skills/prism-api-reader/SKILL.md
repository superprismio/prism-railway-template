---
name: prism-api-reader
description: Read from the Prism Memory API using a read-scoped API key. Use when an agent needs rolling memory, digests, participant activity, knowledge search, knowledge docs, memory/knowledge artifacts such as meeting summaries, or product suggestion outputs without writing to inboxes or triggering ops endpoints.
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
4. For trusted internal meeting and historical-mention questions, use the retrieval
   routes below first. Use legacy artifact detail for explicit legacy artifact IDs.
5. Cite the exact docs, artifact IDs, dates, buckets, and endpoints used.

## Trusted internal meeting retrieval

When the job is already authorized for broad internal Memory reads, prefer:

- `GET /meetings` and `GET /meetings/{meeting_id}` for recent meetings and metadata.
- `POST /retrieval/search` with `query`, `query_mode: literal`, `kind: meeting_summary`,
  and `limit: 10` for focused meeting queries. Omit kind for general retained messages.
- `POST /retrieval/context` with returned generation, record_id, revision, passage_id,
  and max_chars for exact evidence; repeat search on a generation conflict.
- `GET /retrieval/coverage` to describe retained-history limits.

These POST endpoints are read-only. Use existing read-key auth. An environment key
alone does not establish authorization: obey job/profile/channel restrictions.
Public and narrowly scoped callers must use their existing enforced path; never
fall back to broad Memory reads after denial. Handbook/knowledge remains on the
knowledge API. New routes are available only when enabled for the instance.

Use 2–6 distinctive topic terms and explicit date/participant selectors when known.
Search separate periods for cross-meeting changes. Consult the retrieval reference
for context, evidence, and scope rules. Retained history is not complete Discord
history; missing results do not establish that a discussion never occurred.

## Endpoint selection

- Latest memory snapshot:
  `GET /memory/latest`
- Available rolling-memory dates:
  `GET /memory/dates?limit=180`
- Memory for a day:
  `GET /memory/date/{yyyy-mm-dd}`
- Digest for a day:
  `GET /digests/date/{yyyy-mm-dd}`
- Digest for one bucket/day:
  `GET /digests/bucket/{bucket}/date/{yyyy-mm-dd}`
- Active participants in a time window:
  `GET /memory/participants?start=...&end=...&bucket=...`
- Knowledge manifest:
  `GET /knowledge/indexes/manifest`
- Knowledge sources:
  `GET /knowledge/sources`
- Knowledge source detail:
  `GET /knowledge/sources/{source-id}`
- Knowledge search:
  `GET /knowledge/search?q=...&kind=...&tag=...&entity=...&limit=...`
- Knowledge doc:
  `GET /knowledge/docs/{slug}`
- Human-readable knowledge doc:
  `GET /knowledge/view/{slug}`
- Artifact list:
  `GET /api/artifacts?category=...&type=...&source=...&status=...&limit=...`
- Artifact detail:
  `GET /api/artifacts/{artifact-id}`
- Raw artifact:
  `GET /api/artifacts/{artifact-id}/raw`
- Product suggestions:
  `GET /products/suggestions/latest`
  `GET /products/suggestions/date/{yyyy-mm-dd}`
  `GET /products/suggestions/weekly/{yyyy-WW}`

## Retrieval rules

- For knowledge:
  - use `/knowledge/search` first
  - then fetch top matches with `/knowledge/docs/{slug}`
  - when replying with citations, prefer the Prism `doc_url` returned by search/doc responses
  - in chat-style answers, do not leave “Relevant docs” as raw slugs or endpoint paths when a Prism `doc_url` is available
  - if you list supporting docs, format them as human-viewable Prism links first
  - include `source_url` when it exists and adds value, but Prism doc links are the default
  - prefer `guide` and `policy` docs for workflows
  - prefer `reference` docs for templates
- For repo-backed handbook setup or diagnostics:
  - inspect `/knowledge/sources` before suggesting a new source
  - treat an existing `repo_url + branch` source as the canonical sync target
- For memory:
  - use `/memory/latest` for compact current state
  - use `/memory/dates` to enumerate available daily snapshots
  - use `/memory/date/{date}` for a specific day
  - use `/digests/date/{date}` for bucket-level daily detail
- For participation:
  - use `/memory/participants`
  - report the exact `start` and `end` used
- For legacy generated state:
  - `/state/latest`, `/state/objectives`, `/state/signals`, `/state/throughlines`, and
    `/state/projects` are compatibility reads, not the default evidence source.
  - Use only when explicitly asked about that registry; report its as-of time and
    distinguish generated proposals from source-backed commitments.
  - Prefer meeting/message evidence for current decisions, actions, and ownership.

## Legacy registry compatibility endpoints

Only use these for explicit questions about the generated registry. They are not
the default evidence source for current work; report the registry's as-of time.
The query parameter `status=active` is a legacy label, not verified current work.

- Latest project state:
  `GET /state/latest`
- Objective state:
  `GET /state/objectives?status=active&source=portal&externalSystem=portal&objective_key=...`
- Extracted signals:
  `GET /state/signals?anchor=request:26&kind=change_request_ref&objective_key=...`
- Throughline state:
  `GET /state/throughlines?status=active&throughline_key=...`

## Safety

- Treat the Prism Memory API as the source of truth for current deployed state.
- If a route returns empty or `404`, say so directly.
- Do not call write or ops endpoints from this skill.
- Do not guess Prism routes from memory when the API contract already defines them.

## References

- Load [references/endpoints.md](references/endpoints.md) for request patterns.
- Load [references/retrieval.md](references/retrieval.md) for answer construction rules.
