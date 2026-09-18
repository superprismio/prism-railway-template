# Retrieval evaluation

Current rollout and remaining work: [cutover and cleanup runbook](../../../docs/runbooks/prism-memory-cutover-cleanup.md).
The measurements below are versioned checkpoints, not proof all cutover work is done.

Two separate checks are available:

1. `tests/test_retrieval_quality.py` contains controlled, synthetic community scenarios. These are regression contracts: ranking must find specific evidence, meeting identity/dates must stay correct, citations must refer to the exact revision, and scoped access must fail closed.
2. `community_memory.retrieval_eval` evaluates explicitly labeled questions against a retained catalog. It records misses without changing the labels or tuning the engine. No model, API, collector, or production write is involved.

Run the full regression suite from the repository root:

```bash
PYTHONPATH=services/prism-memory/prism_seed/default/code \
  python -m unittest discover -s services/prism-memory/tests -v
```

Install `services/prism-memory/requirements-test.txt` in a virtual environment first.

Run a relevance benchmark:

```bash
PYTHONPATH=services/prism-memory/prism_seed/default/code \
  python -m community_memory.retrieval_eval \
  --catalog /path/to/retained/catalog \
  --suite /path/to/private-cases.json \
  --output /path/to/results.json --k 5
```

Suite format (IDs below are placeholders):

```json
{
  "name": "Community meeting questions v1",
  "generation": "64-character catalog generation ID",
  "cases": [
    {
      "id": "launch-owner",
      "question": "Who agreed to prepare release notes?",
      "query": "release notes",
      "category": "ownership",
      "filters": {"kind": "meeting_summary"},
      "relevant": [
        {"record_id": "64-character record ID", "evidence": "Alex owns release notes."}
      ]
    },
    {
      "id": "absent-topic",
      "question": "Any mentions of unicornzeppelin?",
      "query": "unicornzeppelin",
      "relevant": [],
      "expect_empty": true
    }
  ]
}
```

Use source-reviewed, verbatim evidence labels. Label the evidence before examining rankings; do not generate expected answers from search output. Use a second frozen question set for tuning validation. Pin production-derived suites to a generation; changing the corpus requires reviewing the labels. Keep real source text, participant names, and private benchmark artifacts outside the repository. The checked-in regression fixtures are fictional.

## Metrics and interpretation

- **Known-positive record recall@k**: fraction of labeled records represented in the first k passage slots, averaged over positive questions. Repeated passages consume slots.
- **Evidence recall@k**: fraction of verbatim evidence labels appearing in a retrieved passage belonging to the labeled record. This is deliberately stricter than finding the record; a quote crossing a passage boundary may count as a miss even when neighboring context would recover it.
- **MRR@k**: reciprocal rank of the first known-positive record, averaged over positive questions.
- **Citation errors**: returned offsets/revisions and context checked against the immutable source record.
- **Absence checks**: explicitly labeled no-result questions. These are excluded from positive recall and MRR denominators.
- **Lexical scan recall**: unordered whole-record token matching with the same filters, an unlimited candidate-recall baseline. This is not a comparison with the existing production search API and says nothing about ranked quality.

The runner exits nonzero on citation or absence failures. Ranking misses remain measurements, not automatic failures; CI quality gates require an agreed frozen suite and thresholds. Invalid/missing labels, duplicate question IDs, stale generations, and unanswerable unlabeled cases raise errors.

Question wording and tool arguments are separate. This measures retrieval, not date parsing, query planning, response synthesis, factual answers, or an LLM's ability to distinguish a proposal from a decision. Run a raw-question variant to measure sensitivity to query wording. Relevance labels are provisional positives, not exhaustive judgments: do not interpret recall as precision or overall answer accuracy.

## Initial retained-data benchmark (2026-09-18)

32 questions on a previously copied production snapshot of 230 record revisions and 128 meetings: 30 positive questions and two absence checks. Labels were reviewed by the coding assistant against six meeting summaries; this is a narrow seed benchmark, not independent human validation. Questions include ownership, proposed versus adopted decisions, dates, participant filtering, topic retrieval, and a change across meetings.

| Variant | Known-positive record recall | Evidence recall | MRR |
| --- | ---: | ---: | ---: |
| Focused queries, top 5 | 100% | 98.3% | 98.3% |
| Focused queries, top 10 | 100% | 100% | 98.3% |
| Raw questions, top 5 | 96.7% | 86.7% | 87.2% |

No citation errors or absence failures. Keyword-query median search latency was approximately 102 ms on the local snapshot; this is not a live service load test. The raw-question comparison uses the same 30 positives, excluding absence cases whose full wording adds ordinary OR-match words.

The cross-meeting cohort-change question lost the needed passage at top 5 even when both labeled records were found. With raw questions, launch coordination, hosting alternatives, and Brand Agent scope returned relevant records without the needed evidence; the cohort-change question missed both labeled records. Next experiments: query normalization, passage diversity/grouping, and better bounded context selection. Preserve this baseline when testing changes.

Subsequent validation expanded this to 50 questions over 3,927 retained revisions:
focused evidence recall@10 was 100%, raw-question evidence recall@10 was 92.71%,
and no citation errors were found. The headless scoped HTTP trial measured p95
892 ms at five clients on Railway, using copied meeting authority files. These
remain assistant-labeled/warm-cache checks, not independent answer accuracy or
upstream-permission validation. A chronological legacy artifact inventory was
compared; it is not equivalent to a ranked legacy-search evaluation.

Independent labels, knowledge coverage, upstream permission synchronization, and
end-to-end caller verification remain open. No new UI is required. See the runbook
for concrete consumer and producer retirement work.

## Optional JEV relationship pilot

`community_memory.relationship_pilot` prepares bounded candidates from existing
summary action metadata and selected prose, creates batched TypeSafe Choice/Noul
questions, validates typed provider responses, and materializes experimental
edges with verbatim evidence offsets and revision IDs. The module performs no
network calls or writes. A trusted runner uses a leased `TYPESAFE_API_KEY` and
`TYPESAFE_MODEL` (`jev-latest`) to call the documented TypeSafe systemone API.
Expected evaluation labels and baseline metadata are excluded from the request.

The initial probability threshold is 0.90, selected before the pilot, not
calibrated for production. Lower results abstain. Ownership edges require both
an action classification and explicit-owner judgment over that threshold. They
use meeting-local person names; cross-meeting identity resolution is not assumed.
Dates remain preserved upstream metadata rather than new inferred graph claims.
Project/organization entities are not extracted in this first pilot.

These are judgments about a **summary**, not independently verified transcript
facts. Rechecking existing summary ownership against that same summary tests
consistency, not the accuracy of the original synthesis. The source summary's
existing permissions, current revision, and retention policy must govern any
future display. These experimental edges are not indexed or connected to reader
routes and must not become a new authorization surface. No recurring pass or
review queue is enabled.

Provider reference: <https://docs.typesafe.ai/api>. Question primitives:
<https://docs.typesafe.ai/primitives>.
