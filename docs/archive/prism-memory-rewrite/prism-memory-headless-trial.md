# Headless retrieval trial — 2026-09-18

> Historical checkpoint, not current operating instructions. See the
> [cutover and cleanup runbook](../../runbooks/prism-memory-cutover-cleanup.md).

No new UI or persistent external interface was created. The scoped Memory API was
configured temporarily on localhost inside the Railway Memory container and tested
against a copy of retained meeting authority files. The service credential existed
only in the trial process. The endpoint, copied sources, and key were discarded.
Production routing, credentials, collectors, and upstream permissions were unchanged.

## Changes

A process-wide LRU caches immutable catalog records across requests and scoped
reader instances. It retains at most two snapshots within a combined 32 MiB
serialized-size budget; Python object overhead is additional. Every request still
reads the catalog pointer, applies current scope, and rechecks current authority
files and visibility policy. New generations get new cache keys. Oversized snapshots
are not cached. This relies on generation files remaining immutable.

Search now exposes literal, question, and automatic query modes. Question mode
combines original-query ranking with salient-term ranking using fixed weighted
reciprocal-rank fusion (80/20, rank constant 60). Candidates must match a salient
term; ordinary question words alone cannot produce results. Literal mode preserves
BM25 keyword ranking. The reader skill now specifies focused entity/topic queries,
explicit meeting/date filters, separate period searches for cross-meeting questions,
revision-aware context, and no broad-reader fallback after a scoped denial.

## Validation

- 100 Memory tests passed, including cache sharing/generation changes, oversize
  bypass, query modes, and existing source-change/deletion/scope regressions.
- The frozen 50-question retained-catalog suite retained 100% labeled evidence
  recall@10 for focused queries and both absence checks passed.
- Raw-question evidence recall stayed at 92.71%; MRR moved from 79.36% to 79.53%.
  None of the four existing partial/missing evidence cases was fixed by automatic
  lexical planning. Focused queries remain the recommended tool input.
- No citation errors. These are provisional assistant labels, not human-adjudicated
  accuracy or an independent post-tuning holdout. Reader instructions are not an
  end-to-end LLM query-planner evaluation.
- The temporary scoped HTTP trial used 228 retained meeting revisions and passed
  all five operations, credential rejection, empty scope across all operations,
  argument scope injection rejection, stripped legacy links, warm-cache revocation,
  and failure on missing visibility policy.
- With five concurrent clients and 20 scoped HTTP requests, final-run median was
  790 ms and p95 892 ms. An earlier run measured 778/882 ms. These are small warm-cache
  trials on the deployed Railway container, not sustained capacity or cold-start
  measurements. The earlier 2,145 ms baseline was unscoped in-process full-catalog
  search, so this is not an apples-to-apples speedup ratio.

Run `scripts/scoped_retrieval_trial.py` with the source and catalog arguments in
the Memory README to reproduce the headless API check. It needs no provider key,
UI, or persistent service configuration. It tests the Memory boundary, not actual
Site interface credentials or the Site-to-Memory network path.

## Rollout boundary

The changes are on a review branch. Normal production readers remain unchanged.
An actual scoped caller still needs server-only service credentials, a maintained
visibility policy, and an authorized profile binding. Headless testing does not
replace upstream permission synchronization or independently reviewed relevance
labels. Knowledge repositories and JEV annotations remain outside this catalog.
