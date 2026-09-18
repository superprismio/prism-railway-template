# Shadow retrieval preview — 2026-09-18

> Historical checkpoint, not current operating instructions. See the
> [cutover and cleanup runbook](../../runbooks/prism-memory-cutover-cleanup.md).

Implemented locally; disabled by default; not deployed.

The existing Memory service can now expose read-authenticated, opt-in meeting
listing/detail, lexical passage search, bounded revision-aware context, and coverage
routes over the shadow catalog. Enablement requires `PRISM_SHADOW_CATALOG_ROOT`.
Source and date selectors, participant filtering, limits, and generation checking
are validated. Meeting listing groups related transcript/summary records; detail
preserves alternative summaries. Search is a file-scan BM25 baseline over bounded
passages, without an external database or model dependency.

## Verification

All 20 Python catalog/retrieval tests pass, including actual application opt-in
registration, read authentication, HTTP validation, grouping, source restrictions
in the reader, date boundaries, exact citation offsets, missing catalogs, context
limits, and rejection of stale-generation references. The source-restricted reader
test is not a claim that Site interface policy is integrated.

Read-only smoke queries against the previously copied 230-record production
snapshot returned these results on the local development machine:

| Query | Matching passages | Search milliseconds |
| --- | ---: | ---: |
| SEO | 41 | 113.2 |
| cohort | 335 | 101.4 |
| matchmaking | 10 | 103.6 |
| accounting | 74 | 105.1 |
| deployment | 28 | 103.2 |
| handbook | 25 | 98.9 |

All 128 cataloged meetings were listed in the total count. For each query, the
first three returned passages were verified against retrieved revision context.
These counts are passages, not meetings, and the run is a mechanics/latency smoke
test, not a judged relevance evaluation or Railway concurrency benchmark.

## Remaining gates

No production configuration, files, or collectors were changed. This preview is
restricted to trusted readers with broad Memory read access. Source filters do
not replace interface permissions; stale snapshots do not track source deletion
or access revocation automatically. Do not connect public or narrowly scoped
interfaces before implementing Site policy enforcement and current visibility
checks across search, context, detail, and citations.

Persistent lexical indexing, paginated/grouped search, improved passage boundaries,
knowledge source coverage, human-readable revision citations, and a labeled
retrieval evaluation remain pending. Results report truncation, observed bounds,
and incomplete historical coverage. Next slice should harden interface scope and
visibility before exposing this path to a user-facing chat.
