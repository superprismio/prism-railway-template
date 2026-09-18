# Meeting catalog validation — 2026-09-18

> Historical checkpoint, not current operating instructions. See the
> [cutover and cleanup runbook](../../runbooks/prism-memory-cutover-cleanup.md).

Status: local implementation and read-only production-data validation complete;
not deployed. This is a bounded meeting-catalog slice, not the retrieval cutover.

## Input and scope

Copied 230 processed inbox JSON records from the active Railway `prism-stack`
Memory tree into local scratch storage. Selected records had a meeting-like type
or a Discord recording source. Event timestamps span April 23–September 17, 2026.
The selection includes five meeting-agenda drafts; it is not a full workspace
snapshot, nor a transactionally frozen volume backup. Source files were read
only. Raw transcripts and participant data were not added to the repository.

## Deployed post-meeting flow

The communication adapter explicitly enables summary generation and summary
Memory ingestion. Transcript ingestion has no explicit environment override;
the repository default is false. The enabled `recording-transcript-completed`
hook points to `recording-transcript-review-publish`, whose deployed version 4
uses deterministic recording processing. The hook was last triggered September
17. Its configured child workflow is `raidguild-recording-post-publish`.

The inspected local handler reuses an existing Memory summary reference; only
when absent does it promote the upstream summary. Raw transcript ingestion is
skipped by default. This establishes the intended primary summary path without
assuming every historical record followed it. No hook was triggered or edited.

## Results

| Measure | Initial catalog | Revised catalog |
| --- | ---: | ---: |
| Input files | 230 | 230 |
| Logical records | 229 | 230 |
| Stored revisions | 230 | 230 |
| Linked meetings | 83 | 128 |
| Records with only legacy path identity | 146 | 8 |
| Conflicting revisions within a producer record | 1 | 0 |

The extra logical record preserves different producer outputs rather than
collapsing them. All 85 Discord transcripts and 53 older summaries lacked
structured session metadata. Their recording URLs recover 138 session identities.
An independent grouping by source recording URL verifies 117 Discord sessions,
including 85 transcript/summary pairs, with content, metadata, and participants
unchanged. Across the full selected input there are 85 paired and 43 partial
meetings. Partial means only one artifact kind is present in this snapshot, not
necessarily a failed recording.

Seven meetings contain alternative summaries. Both versions remain available;
the catalog does not infer which producer is authoritative from arrival time.
Five meeting artifacts remain explicitly unlinked: one workflow summary with no
session identity, two repaired Portal artifacts, one Discord attachment transcript,
and one manual-upload transcript. Their document/artifact IDs are preserved but
are not treated as recording session IDs. The eight legacy-path identities include
non-meeting agenda records. No content-based merge or fuzzy participant matching
was performed.

## Implementation

- Catalog schema v2 distinguishes producer record identity from shared meeting
  identity, supports the known Discord workflow namespace, and recovers legacy
  Discord voice session UUIDs from HTTPS recording URLs.
- Contradictory structured session identity and recording URL fail validation.
- Reports expose unlinked meeting artifacts and alternative summaries.
- A shared adapter metadata helper supplies both transcript and summary payloads
  with session, guild, channel, timing, and stable participant-presence metadata.
  Presence uses its own field so inbox display-name normalization cannot overwrite it.
- Site recording fallback and browser-capture promotion now explicitly carry
  session identity; recording fallback also carries start/end timestamps.

## Verification and next boundary

All 12 Python catalog tests, 39 source-adapter tests, and 8 targeted Site recording/
capture tests pass. Source-adapter and Site TypeScript checks pass. An initial Site
test invocation from the repository root failed to resolve its local import alias;
rerunning from the Site workspace passed. Whitespace validation passes.

Two rebuilds over identical snapshot bytes produced the same generation, and
hash checks verified snapshot immutability. Regression tests use invented values
reproducing the observed payload shapes, not copied private meeting content.

Generation: `10adad624510ef5fd50e530b038f4875fdda0cdca9d14186a798c56b55a2f56e`.

Next: read-only meeting listing/detail and passage retrieval over this catalog.
Unlinked legacy artifacts remain searchable records for that slice; any future
link repair needs explicit provenance. Production snapshot/rollback preparation,
raw-bucket reconciliation, knowledge indexing, and deployed producer rollout
remain separate work. No production files, collectors, hooks, or configuration
were changed during this validation.
