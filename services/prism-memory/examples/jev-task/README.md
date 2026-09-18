# Optional JEV classification task

This is a request-backed agent workflow, not a standalone deterministic script:
the runtime already has authorized Memory access and receives the provider key
through Gateway. It uses an explicit `admin-agent` executor at the economy tier;
there is orchestration-model overhead even for no-op runs. The task and workflow
are disabled by default. Replace the accountable domain, executor, and Gateway
credential key for another instance before installing these examples.

Install SKILL.md through POST /agent/skills as name prism-memory-jev-classifier,
then workflow.json through POST /agent/workflows and task.json through
POST /agent/tasks. Do not store a provider key in these files. The existing
`typesafe-jev-api` credential must lease `TYPESAFE_API_KEY` to the trusted workflow.

Deploy Memory with its existing catalog enabled before manually validating the
workflow. The endpoints are ops-key-only:

- POST /ops/annotations/jev/pending with `{"limit":2}` returns at most two requests.
- POST /ops/annotations/jev/results validates and stores a provider response against
  its exact record/revision and annotation policy ID. It returns 409 for changed,
  missing, or ambiguous evidence, and 422 for invalid classifications.

The existing pilot selects up to six verbatim candidates per summary from explicit
upstream action items and decision/proposal language. This is not exhaustive
extraction. Summaries over 16,000 characters, unverified meeting identities, and
conflicting record revisions are skipped and counted. Recent eligible summaries
are processed first. An empty annotation store includes a bounded historical
catch-up backlog; it does not presume all existing summaries were classified.

TypeSafe [Choice questions](https://docs.typesafe.ai/primitives) return a probability
distribution over action, decision, proposal, unresolved, and other. Store the
provider model and exact source revision, abstain below 0.90, and never treat these
as independently verified decisions. JEV is the classifier; the orchestrating
agent must not substitute its own answers. No ownership or graph edges are stored.

Cache identity includes policy version, source revision, and exact provider request
(including model selector). `jev-latest` is an alias: provider changes behind that
alias do not automatically invalidate older annotations. To intentionally rerun
with a new policy/model, change the version or model selector. Files live under
`annotations/jev/<annotation-id>.json`, separate from inbox/catalog inputs. Historical
annotations remain audit records after source edits/deletions; they are not exposed
by search. Any future annotation reader must revalidate source revision/visibility.

Provider failures leave candidates pending; they cannot interrupt normal collection,
recaps, or retrieval. Each workflow occurrence allows two calls with 45-second
timeouts and no in-run provider retries. Request receipts preserve attempted IDs
before sending, so a resumed request does not repeat ambiguous calls. A later
occurrence may retry a failed candidate; these are bounded attempts, not a monetary
billing cap. Concurrent manual invocations can repeat provider work; annotation
commits are idempotent, but this is not an exactly-once provider guarantee.

Deployment gate: verify one manual workflow request, its private receipt, the
stored annotations, and an unchanged second pass before enabling the daily
`06:17 America/Denver` schedule. Enabling recurrence requires operator approval. No messages
are sent to Discord, email, or any other community destination.


## Live validation, September 18, 2026

Manual request #2803 classified two summaries with JEV 1.13.0: 11 judgments,
one abstention, two revision-bound annotation files. Reposting the same results
returned cached twice; pending work fell from 102 to 100 and neither completed
revision was selected again. Search remains independent of these annotations.

The initial workflow used an incorrect artifact endpoint and required receipt
recovery before closing. The instance skill and this example now specify the
exact Site UUID write route, distinguish Site from Memory authentication, require
a successful attempt receipt before provider calls, and prevent selecting fresh
batches while resuming the same request. A fresh request #2804 is the verification
of this correction. The daily task remains disabled until that verification and
operator approval to enable recurrence.

Daily is the selected cadence; the two-summary cap remains unchanged. Handle any
historical catch-up separately rather than increasing recurring frequency. The
example timezone is instance-specific and should be changed for another deployment.
