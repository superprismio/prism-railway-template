# Prism Memory: File-First Retrieval Rewrite

Status: architectural target, partially implemented. Trusted internal reader cutover is live.
Current status and remaining work: [cutover and cleanup runbook](../runbooks/prism-memory-cutover-cleanup.md).

Date: 2026-09-18

## 1. Decision and product boundary

Prism Memory stores source evidence, preserves useful upstream enrichment, and
makes both easy for agents and interfaces to retrieve. It maintains a compact
rolling recap. It does not require an operator to maintain inferred objectives,
throughlines, ownership assignments, or project lists.

Keep Python and the existing FastAPI service. Keep Markdown and JSON as the
authoritative storage format. No vector database, embeddings, semantic database,
or database service is required. Search indexes are derived files that can be
deleted and rebuilt. This is a staged internal rewrite with API compatibility,
not a replacement of the working recording or knowledge-sync systems.

Meeting synthesis remains an upstream post-meeting operation. Cross-meeting
analysis, relationship exploration, matchmaking, and creation of new tools belong
in agents and interfaces using retrieval. Those outputs become durable material
only through an explicit save/promotion operation.

## 2. Evidence and constraints

The September 18 read-only inspection found approximately 4,078 raw memory JSON
files, 4,079 processed inbox records, 600 daily digest JSON files, and 1,841
knowledge Markdown documents in the live `/data/prism_seed/community` tree.
These are file counts, not unique messages or meetings. Generated state contained
870 objectives, 337 throughlines, and no projects. The sample showed automated
cleanup commentary contributing to the apparent activity of older work.

Repository behavior relevant to this design:

- The communication adapter already produces meeting summaries, tags, action
  items, quotes, participants, and timing; a completion hook can invoke additional
  instance-owned processing. Actual deployed hook configuration must be inventoried.
- Meeting metadata survives Memory inbox normalization. Direct transcript ingest
  carries less structured session metadata than summary ingest.
- Daily digest decisions and actions largely depend on keyword matching and
  source-text truncation. They do not consistently use upstream structured actions.
- Rolling memory has a four-day carry-forward drop window and small section caps.
  This limits the recap, not the retained historical evidence.
- Knowledge search currently scans manifest entries and document text for query
  tokens. GitHub source synchronization already has stable per-source identities.
- Inbox writes receive random filenames; normalized record IDs depend partly on
  filenames. Repeated imports can therefore duplicate a source event.
- `/ops/memory/backfill` invokes collection and daily rebuilds, but the active
  inbox collector ignores `force` and `backfill_hours`; it does not reclassify the
  processed inbox.
- Discord historical search is implemented on the inspected local branch. Its
  spec still marks deployment verification pending; availability is not assumed.

The previous [state specification](prism-state-signals-objectives.md) remains
historical design context. This proposal supersedes its generated-state direction
when implemented, without deleting existing state or curation data.

## 3. Primary user journeys

1. Find the latest meeting, optionally within a series/channel, and answer from
   its existing summary with a link to the transcript.
2. Find meetings by participant, topic, date, or explicit project context.
3. Compare a topic across multiple meetings, retrieving supporting passages and
   identifying changes, uncertainty, and disagreements.
4. Answer a handbook question within a server-enforced knowledge-source scope.
5. Find recent or historical mentions in retained evidence, with optional
   authorized Discord history fallback.
6. Show a raid/channel timeline without maintaining a second project registry.
7. Produce a concise recap with source links and honest coverage information.

No journey requires a model provider or a daily human review queue merely to
collect, store, filter, or search records. A generative model is required only
for newly generated prose; stored summaries remain usable without one.

## 4. Architecture and responsibilities

| Component | Owns |
| --- | --- |
| Communication adapter / post-meeting workflow | Recording, transcription, meeting summary and metadata, source IDs and revisions |
| Knowledge source sync | Fetching source revisions, document identity, source removals and sync status |
| Memory | Normalization, artifact linkage, file storage, derived lexical indexes, bounded retrieval, recap inputs and outputs |
| Site | Interface policy, effective source scopes, agent-facing proxy, configuration and skill management |
| Answering agent / interface | Query refinement, authorized source-history fallback, source-grounded synthesis |

Memory does not call Discord during an ordinary local search. Source history
remains a distinct capability, accessed through Site and the communication
adapter. Searching history does not implicitly ingest it or advance collection
checkpoints. Explicit backfill is a separate job.

### Suggested file organization

```text
existing inbox/, buckets/, knowledge/     # preserved legacy/source artifacts
records/<source>/<shard>/<record-id>.json # normalized envelopes, pointing to content
meetings/<meeting-id>.json               # linked artifacts and meeting metadata
annotations/<record-id>/<version>.json   # optional derived observations
relationships/<shard>/<edge-id>.json     # evidence-backed links; rebuildable
indexes/generations/<generation-id>/     # manifests, postings, passages, facets
indexes/current.json                    # atomically published generation pointer
recaps/daily/YYYY-MM-DD.{json,md}
recaps/rolling/latest.{json,md}
migrations/<run-id>/                     # inventory, identity map, discrepancies
jobs/<job-id>/                           # replay/backfill checkpoints and results
```

Logical IDs may contain source-specific separators; filesystem names use validated
encoded IDs or hashes. Existing artifact paths and URLs remain resolvable. Avoid
duplicating large content when an immutable source file can be referenced.

## 5. Record and meeting contracts

Every normalized record contains:

- `schema_version`, `record_id`, `source`, `source_record_id`, `kind`;
- `revision`, `content_hash`, `content_ref`, `source_url`;
- `occurred_at`, optional `ended_at`, `ingested_at`, `source_updated_at`;
- `title`, optional upstream `summary`, tags and provenance-bearing metadata;
- source scope references: workspace/guild, channel, thread, knowledge source;
- optional `meeting_id`, participants, and explicit context references;
- `origin`: human, automation, mixed, or unknown; `derived_from` references;
- availability/deletion state and any source coverage limitations.

Record kinds include message, meeting transcript, meeting summary, knowledge
document, and artifact. Bucket names remain compatible labels, not identities.

Identity is stable across replay: Discord uses guild + channel + message ID;
meetings use producer namespace + session ID; knowledge uses source ID + path.
Source edits create a new revision under the same logical identity. Identical
retries are no-ops. Different source messages with identical text remain distinct.

Legacy records without reliable IDs receive deterministic legacy identities and
an identity-quality marker. Content/time similarity creates a possible-duplicate
report, never an automatic destructive merge. Prefer authoritative IDs extracted
from verified metadata or canonical source links when available.

A meeting manifest links transcript, summary, recording, and attachment records.
It preserves start/end time, channel, participant IDs where available, display
names, tags, title, summary version, and processing completeness. Presence and
speaking are separate facts; missing stable participant IDs must not be invented.
Display-name matching is a search convenience, not proof of person identity.

Actions retain supplied owner/due-date fields and their provenance. Add evidence
references when available; mark legacy extracted claims without passage references
as unverified extraction. Do not infer accepted ownership from a person's mention.
Store suggestions and commitments distinctly when the producer provides them.

Meeting producers should attach the same structured identity and time metadata
to both transcript and summary. A later summary revision updates the meeting
manifest without creating another meeting. Transcript-only and summary-only
meetings remain valid and searchable, with explicit completeness flags.

Summary generation remains configurable through `recording-summary-profile` and
existing post-meeting hooks. Do not add an unconditional second summarization pass.
Before rollout, audit long-meeting coverage: the inspected adapter summary path
currently truncates its transcript input at 120,000 characters.

## 6. File-based search

Implement a source-neutral retrieval module behind the existing service. Build
deterministic passage files and an inverted lexical index using JSON/JSONL shards.
Use Unicode-aware tokenization, exact identifiers, phrase matching, and BM25-style
ranking with explicit boosts for titles, tags, and upstream summaries. Pin the
tokenizer, ranking, and chunking versions in each index generation.

Passages respect headings, speaker turns, and paragraph boundaries; long units
are split with bounded overlap. Every passage carries record ID, revision, text
offsets or line spans, and timestamps when supplied. Display citations always
refer to the indexed revision. Source edits rebuild affected passages.

Apply source authorization and metadata filters before ranking and aggregation.
Group results by meeting or document when requested, so transcript and summary
copies cannot dominate the result list. Recency affects ranking only when requested
or when answering a time-oriented query; old evidence remains discoverable.

Query-time agents may try alternate phrases and aliases. This is lexical query
expansion, not a semantic index. Log which queries produced evidence. User-supplied
search strings are data, never shell commands. Any ripgrep fallback uses bounded
arguments, literal matching by default, and the same authorization/filter rules.

Publish complete index generations atomically. Serialize writes per identity and
index publication within the sole volume-owning Memory service. Readers pin one
generation; failed builds leave the last good generation available and report its
freshness. Rebuilds, model calls, and backfills run as resumable jobs, not long
blocking HTTP requests. A missing index permits bounded file-scan retrieval with
an explicit degraded/partial indicator.

Deleted, withdrawn, or newly unauthorized source records must not remain visible
through stale indexes, context expansion, cached answers, or artifact routes.
Preserve provenance only according to the configured retention/deletion policy;
file-first does not imply irrevocable retention. Apply authorization against
current policy even while reading an older index generation.

### Proposed API additions

These are new contracts, not claims about existing routes. Memory uses existing
read/ops authentication; Site provides policy-scoped agent/interface proxies.

| Route | Purpose |
| --- | --- |
| `POST /retrieval/search` | Query plus source/kind/date/participant/context filters, grouping, limit and cursor |
| `POST /retrieval/context` | Bounded neighboring passages for returned record/revision/passage IDs |
| `GET /meetings` | Filtered meeting listing, sorted by occurrence time |
| `GET /meetings/{id}` | Meeting metadata and authorized linked artifacts |
| `GET /retrieval/coverage` | Source coverage, index freshness and known gaps |
| `POST /ops/retrieval/reindex` | Start a scoped index job |
| `POST /ops/memory/replay` | Start a scoped historical normalization/enrichment/recap job |
| `GET /ops/jobs/{id}` | Job progress, counts, errors and checkpoint |

Search responses include effective scope, index generation, applied filters,
coverage, warnings, grouped hits, source URLs, evidence excerpts, revision IDs,
match reasons, and an opaque cursor. Default 20 results, maximum 100; context
defaults to 8,000 characters, maximum 32,000 per call. Date windows use inclusive
start/exclusive end, with the resolved timezone echoed. Filter-only searches are
valid. Cursor pagination is bound to query, scope, and index generation; expiration
returns an explicit restart instruction rather than silently skipping records.

### Scoped interfaces

An interface references allowed knowledge sources and/or source scopes in Site
policy. Requested scope can only narrow that policy. Search, context, artifact
reads, counts, and fallback all enforce the intersection. A handbook-only interface
cannot expand into Discord or unrelated documents through query refinement or a
linked passage. Do not give such an interface the unrestricted Memory read key.

## 7. Automatic Discord context, minimal configuration

Project context is optional. An operator selects a Discord category once through
an agent skill or UI. The skill resolves current guild categories and persists
stable IDs; duplicate names require disambiguation. Nothing is hardcoded to Raids.

Proposed addition to `space.json`:

```json
{
  "retrieval": {
    "project_context_sources": [
      {"source": "discord", "guild_id": "<resolved-guild-id>",
       "category_id": "<resolved-category-id>"}
    ]
  }
}
```

Discover children automatically from the adapter's authorized topology. Each
channel is a contextual work area; threads inherit it, and forum posts inherit
their forum unless explicit source metadata supplies a narrower context. Preserve
channel identity across renames. Record topology observation time; do not assume
today's category membership proves where a historical message belonged.

New channels require no edits. Removed/moved channels retain historical context;
current membership is separate from event-time context. Missing topology produces
an unknown-context marker rather than a fabricated assignment. Cross-channel or
meeting references may link to a work area when explicit; inferred links remain
optional annotations. There is no name-prefix requirement or objective taxonomy.

## 8. Recaps and optional observations

Keep a daily recap and compact rolling recap with source-linked highlights. Use
upstream meeting TL;DRs, structured decisions/actions, and selected discussion
evidence. Do not convert whole summaries into actions because they contain words
such as "should" or "task". Count each meeting once.

Automated summaries, cleanup reports, and previous recaps are derived material.
They cannot independently establish renewed underlying project activity. Record
the actual automation event when useful, but do not treat its references to old
work as new work. Preserve derivation links to prevent recursive recap ingestion.

Default rolling window: seven local calendar days with an explicit as-of time and
bounded output budget. The final budget is tuned on evaluation data. Window expiry
means exclusion from the recap, never task completion or evidence deletion.
If synthesis is disabled/unavailable, render dated upstream summaries/highlights
deterministically and mark the synthesis status. No provider failure blocks ingest.

Optional observations may describe a proposal, commitment, decision, blocker,
relationship mention, or explicit ownership statement, with source/revision and
evidence references. They are not a persistent task registry. Unknown, ambiguous,
and conflicting claims remain representable. No compulsory review queue, automatic
objective creation, or inferred completed status is part of the core rewrite.

### 8.1. Lightweight relationships and graphical views

Include explicit relationships in the core record contract. Initially support
`artifact_of`, `attended`, `in_context`, and `references`, derived from session
IDs, attendance metadata, source topology, and explicit links. Preserve whether
an artifact is a transcript or summary. A channel context is not automatically a
confirmed project, and a participant display name is not a verified person ID.

An optional second pass may propose `discusses` links between meetings/discussions
and known work contexts, or disambiguate document references. Generate candidates
from IDs, links, names, tags, and lexical retrieval; avoid all-pairs comparison.
Jev may judge those candidates against bounded source evidence. Keep inference
separate from explicit links, and evaluate it before using it to expand retrieval.
Relationships such as ownership require explicit commitment evidence; attendance,
mentions, and discussion alone do not establish ownership or expertise.

Each edge records a stable identity, subject ID, predicate, object ID, evidence
record/revision and passage references, event time, derivation method, extractor
version, and uncertainty when inferred. Distinguish observed time from any known
validity interval. Unsupported validity dates remain unknown. Superseded revisions,
deleted evidence, and changed topology invalidate or rebuild affected edges;
historical links remain tied to their original evidence and time interpretation.
These JSON edge files and adjacency indexes require no graph database. Explicit
relationships can be reconstructed from source records; inferred ones can be
regenerated from their versioned inputs. Do not store required manual curation
only in a disposable relationship index.

Upstream producers supply relationships they can establish directly. Memory's
optional second pass connects records across the wider collection. Query-time
agents may investigate speculative associations such as collaboration opportunities;
these are not automatically persisted as facts. No relationship review queue is
required for normal operation.

This structure enables clearer graphical representations: a meeting with its
participants and artifacts, a raid timeline linked to relevant discussions and
meetings, or a document view showing where it was referenced. Prefer a selected
entity and a bounded neighborhood, or a timeline, over a workspace-wide graph.
The initial visualization experiment should be a meeting-centered evidence view
and should demonstrate easier navigation to the underlying sources.

Views distinguish explicit and inferred links with labels and visual treatment,
support time/source/type filters, and open supporting passages on selection.
Node size, proximity, and connection count must not imply authority, expertise,
ownership, or completeness. Apply current authorization to both endpoints and
supporting evidence before returning edges, counts, or expanded neighbors; hidden
sources must not leak through graph structure. Expose coverage, result limits,
and index freshness alongside the view.

Acceptance additions: explicit links survive replay with stable IDs; edges cite
the correct revisions; invalidated evidence cannot support current links; and
bounded traversal cannot escape source scope. Evaluate inferred links using
held-out supported/unsupported candidate pairs and measure whether expansion
improves evidence retrieval without unacceptable unrelated results. Ship graphical
views and inferred traversal only after these gates pass; neither blocks core
search or meeting retrieval.

## 9. Jev experiment

Jev is an optional enrichment provider, initially evaluation-only. Implement a
separate typed-decision adapter; do not force it into the current generated-text
JSON provider contract. Batch independent questions sharing a passage/conversation
state: substantive update, recap versus new event, proposal versus accepted
decision, accepted responsibility, and digest relevance. Supply surrounding
context and define unknown/none options where applicable.

Date extraction may use constrained component choices plus deterministic
resolution. Anchor relative dates to the original event time and relevant timezone.
Do not copy a cookbook's future-year or weekday convention blindly into historical
replay; preserve unresolved ambiguity and the applied interpretation rule.

Cache by content revision, context hash, model/provider version when available,
prompt/rubric version, and relevant configuration. Store output and provenance in
annotation sidecars. Failed or uncertain classification falls back to searchable
unclassified evidence; it never deletes or hides the source. Independently measure
threshold quality on held-out labeled examples. Typed output is not proof of truth.
Use normal credential handling; keys never enter source files, prompts, or reports.

References: [primitives](https://docs.typesafe.ai/primitives),
[date extraction](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook).

## 10. Migration, replay, and Discord backfill

1. Inventory active data roots, recording hooks, scheduled jobs, interface scopes,
   UI consumers, artifact URLs, backups, and current API callers. Distinguish the
   active tree from old migration trees. Take and verify a restorable snapshot.
2. Build shadow normalized records and indexes from retained raw/inbox/knowledge
   files. Preserve original files; record every source-to-record mapping and parse
   failure. Reuse existing meeting summaries and metadata.
3. Replay a representative 30-day period. Replay stages are explicit: normalize,
   index, optional annotate, optional recap. Do not call collectors, post messages,
   trigger meeting workflows, or update live collector checkpoints.
4. Evaluate shadow retrieval and a handbook-scoped interface. Compare against
   current answers using the same questions and evidence.
5. Fill selected Discord gaps only after verifying the deployed history capability.
   Search is useful for targeted discoveries; exhaustive backfill needs authorized
   chronological channel/thread traversal, stable message IDs, independent cursors,
   rate-limit handling, and per-scope coverage records. Split bounded windows where
   necessary; no search result count is treated as proof of completeness.
6. Reindex and regenerate selected daily recaps after imports. Historical rebuilds
   write their own dated outputs; they never move live `latest` backward. Relative
   dates and weekly boundaries use original occurrence time, not import time.
7. Expand to retained history after gates pass. Switch readers and recap generation
   through a configuration flag; keep the old paths available for rollback.

Coverage records distinguish observed records, attempted intervals, successfully
traversed intervals, unknown gaps, permissions, failures, and unavailable/deleted
content. Discord search cannot recover unrecorded audio. Missing meeting transcripts
require retained adapter artifacts or another original source.

Replay/import jobs are resumable and idempotent, with counts of scanned, created,
updated, duplicate, skipped, failed, and unresolved-identity records. Retries cannot
create duplicate meetings. Model work has an explicit record/cost budget. Production
cutover and any destructive cleanup are separate, reviewable operations.

## 11. Legacy state and compatibility

Do not translate old generated objectives into authoritative new entities. Preserve
legacy state and manual curation as historical artifacts. Explicit curated aliases
may become optional context hints only after verifying their provenance.

Keep existing memory, digest, knowledge, and artifact read routes operational.
Add retrieval routes first; migrate reader skills, Site Memory Explorer, and scoped
interfaces gradually. Knowledge source sync remains the producer of existing
knowledge partitions. Compatibility serializers preserve required legacy fields;
additive metadata identifies new recap provenance and coverage.

Once consumers are migrated, disable scheduled project/objective/throughline
builders and their cleanup tasks. Label retained state endpoints as frozen legacy
data with their true as-of time; do not silently expose stale state as current.
Remove default UI emphasis on those views. Product seed workflows may continue as
downstream consumers but are not implicitly run by replay. Route removal requires
a separately documented deprecation after caller inventory.

Rollback switches readers and recap generation to the old implementation without
reverting source evidence. Keep new incoming records compatible with the legacy
inbox during rollout. Verify rollback on a copy before production cutover.

## 12. Evaluation and release gates

Create 40–60 real questions spanning last meeting, participant/date filters,
cross-meeting changes, exact historical mentions, handbook-only answers, raid
context, absent evidence, and conflicting commitments. Label expected evidence
IDs and coverage requirements before tuning. Add 200–300 representative passages
for optional classification, with a held-out subset. Model judgments may assist
labeling but do not replace adjudicated expected evidence.

Required correctness tests:

- Identical imports/replays leave logical counts unchanged; edits update revisions.
- Summary and transcript group under one meeting; legacy uncertainty is retained.
- Timezone/DST boundaries, old relative dates, and transcript/summary-only sessions
  behave correctly. Replaying old days never overwrites live latest.
- Scope enforcement covers search, counts, context, artifact links, and fallback;
  unauthorized-source leakage is zero across the adversarial scope test set.
- Reindexing from files produces equivalent records and deterministic ranking;
  interrupted builds preserve the last good generation.
- Deletion and access changes suppress stale hits. Citations resolve to the exact
  revision or explicitly report unavailability.
- Recaps do not count duplicate artifacts as separate meetings or revive old work
  merely because maintenance commentary mentions it.
- Missing providers, failed classification, and partial history produce explicit
  status while deterministic ingest and retrieval continue.

Proposed quality gates: at least 90% evidence Recall@10 on the held-out answerable
questions, no regression in exact-ID/date/participant cases, and every asserted
decision/owner/date in evaluated recaps supported by cited evidence. Measure current
baseline first; publish per-journey failures, not just an aggregate score. Jev
activation additionally requires measured false-positive/false-negative rates and
a documented threshold choice; it is not a dependency of initial release.

Target local retrieval p95 under two seconds on the current corpus at five
concurrent readers, excluding model/provider time. Benchmark memory, index size,
incremental rebuild time, cold start, and context latency on Railway-sized resources.
If unmet, profile and optimize the file index before considering a language change.

## 13. Implementation slices

| Slice | Deliverable | Completion condition |
| --- | --- | --- |
| 0: Baseline | Read-only inventory, labeled questions, API-consumer map, fixture snapshot | Known coverage and reproducible current baseline |
| 1: Meetings and identity | Canonical envelopes, meeting manifests, explicit relationship contract, idempotency, producer metadata alignment | Existing summaries preserved; retry/edit/linkage tests pass |
| 2: Retrieval | File index, passage/context API, meeting filters, Site scope enforcement, updated reader skill | Retrieval and isolation gates pass without a model |
| 3: Recaps and context | Structured meeting recap inputs, automatic category discovery, optional raid timeline | Useful recaps with no mandatory curation or generated registry |
| 4: Replay and cutover | Resumable replay, selected Discord gap fill, compatibility UI/API migration, rollback | Shadow evaluation and cutover checklist pass |
| 5: Optional Jev | Typed adapter, annotation evaluation, calibrated use of results | Demonstrated improvement on held-out examples within budget |
| 6: Optional relationships and views | Candidate-link second pass, scoped adjacency retrieval, meeting-centered graphical evidence view | Link accuracy, invalidation, scope, and navigation gates pass |

Implementation anchors: `community_memory/collector.py`, `digest.py`, `memory.py`,
`pipeline.py`; `community_memory_api/storage.py`, `schemas.py`, `app.py`;
`community_knowledge/source_sync.py`; `source-adapter/src/voice.ts`;
Site `meeting-memory.ts`, Memory Explorer, interface policy and reader skills.
Introduce dedicated normalization, meeting-catalog, retrieval, and job modules
rather than adding all new responsibilities to the existing storage module.

## 14. Decisions deferred until inventory/evaluation

- Which deployed post-meeting hook is authoritative when multiple summaries exist?
  Preserve all versions until this is established; do not choose by arrival alone.
- Which historical scopes have retained transcripts versus only summaries?
- What are the current interface visibility rules and artifact-sharing requirements?
- Which legacy routes and scheduled cleanup jobs still have active consumers?
- What recap size and overlap produce the most useful seven-day view?

These questions do not block a read-only baseline and shadow meeting catalog.
Broader relationship applications, matchmaking, automatic project discovery beyond
configured source structure, and a general objective-management product remain
later consumers of retrieval. The bounded relationship/view experiment in section
8.1 is optional and does not expand the core rewrite's release requirements.
