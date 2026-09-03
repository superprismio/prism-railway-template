# Admin Fallback Replacement Map

Recorded: 2026-09-01

Status: step-2 migration in progress. The Participation batch was applied to
the live `prism-stack` instance on 2026-09-01; the remaining batches are still
proposed.

This map is based on the live `prism-stack` accountability audit after the
step-1 domain and steward-category reorganization. The initial audit reported
172 Admin fallbacks across 56 definitions. After the Participation batch, 162
remain. The purpose of this pass is to replace genuine
fallbacks with explicit domain or specialist Agent Profiles, preserve deliberate
cross-domain execution, and make intentional Control Plane use of the Admin
Agent explicit.

Changing an executor does not transfer definition ownership. A workflow or task
continues to belong to its Accountability Domain even when a specialist profile
from another domain executes one of its steps.

## Summary

| Accountability domain | Initial fallbacks | Proposed default executor | Review state |
| --- | ---: | --- | --- |
| Accounting | 1 | New `accounting-steward-agent` | Clear |
| BizDev | 2 | `bizdev-agent` | Clear |
| Brand & Communications | 105 | `brand-agent` | Mostly clear; mixed workflows require review |
| Community Operations | 20 | `sync-steward-agent` | Clear with specialist exceptions |
| Governance | 1 | `rip-steward` | Clear, intentional cross-domain execution |
| Handbook & Knowledge | 22 | New `knowledge-steward-agent` | Clear except the lore workflow |
| Participation | 10 | `participation-steward-agent` | Applied 2026-09-01; 0 remain |
| Platform Operations | 9 | Explicit `admin-agent` | Intentional Control Plane exception |
| Software Delivery | 2 | `codegen-agent` | Clear |

Veydrift Operations has no Admin fallbacks requiring replacement.

## Accounting

Create `accounting-steward-agent` and assign it to:

- task `weekly-raidguild-accounting-sync`.

The profile should be narrowly scoped to evidence collection and reconciliation.
It must not make payments or mutate treasury state without a separately approved
operation.

## BizDev

Assign `bizdev-agent` to:

- workflow `crm-document-ingest-enrich`, step `intake`;
- workflow `project-kpi-snapshot`, step `collect-snapshot`.

Other BizDev execution is already explicit.

## Brand & Communications

The default proposal is to assign all currently falling-back agent steps in the
following workflows to `brand-agent`:

- `blog-post-draft-review-publish`;
- `blog-post-steered-draft-review-publish`;
- `content-distribution-bundle`;
- `daily-memory-brief-review`;
- `field-notes-from-fireside`;
- `fireside-blog-post-draft-publish`;
- `fireside-recap-video-publish`;
- `internal-daily-brief-podcast-publish`;
- `member-highlight-research-review-publish`;
- `member-newsletter-draft`;
- `plausible-analytics-report`;
- `portal-post-editorial-revision-publish`;
- `publish-queen-raida-article`;
- `queen-raida-portal-launch-campaign`;
- `queen-raida-x-follow-scout-review-follow`;
- `queen-raida-x-response-draft-review-publish`;
- `weekly-public-brief-podcast-publish`.

Assign these launcher and reporting tasks to `brand-agent`:

- `blog-post-steered-one-off-request`;
- `blog-post-workflow-weekly-request`;
- `daily-raidguildish-x-activity-report`;
- `internal-daily-brief-podcast-request`;
- `queen-raida-daily-x-response-request`;
- `queen-raida-weekly-x-follow-scout-request`;
- `queen-raida-workday-discord-checkins`;
- `queen-raida-x-collection`;
- `raidguild-org-weekly-analytics-csv-reminder-2026-06-05`;
- `weekly-public-brief-podcast-request`;
- `weekly-raidguild-org-analytics-report`.

Review these mixed workflows before bulk assignment:

- `field-notes-from-fireside`: source and session steps may belong to
  `sync-steward-agent`;
- `fireside-recap-video-publish`: session intake and resource publication may
  belong to `sync-steward-agent`;
- `content-distribution-bundle`: delivery coordination may cross Brand and Sync;
- `plausible-analytics-report`: confirm Brand rather than BizDev.

## Community Operations / Sync Steward

Assign `sync-steward-agent` to all falling-back agent steps in:

- `meeting-transcript-memory-ingest`;
- `portal-session-description-loop`;
- `portal-session-recording-complete`;
- `weekly-portal-activity-snapshot`.

Assign these tasks to `sync-steward-agent`:

- `daily-bard-calendar-discord-brief`;
- `raider-roundtable-agenda`.

Split `raidguild-recording-post-publish` explicitly:

| Step | Executor |
| --- | --- |
| `raidguild-portal-publish` | `sync-steward-agent` |
| `notify-discord` | `sync-steward-agent` |
| `propose-action-item-changes` | `action-items` |
| `emit-bd-signals` | `bizdev-agent` |

Use specialist profiles for these tasks:

- `weekly-action-items-discord-digest` -> `action-items`;
- `summer-brigade-weekly-growth-report` -> `summer-brigade-26`.

Summer Brigade remains categorized under Sync Steward while retaining its
specialized profile.

## Governance

Assign task `dao-proposal-watcher` to `rip-steward`.

This is an intentional cross-domain executor reference. The RIP Steward profile
is categorized under Knowledge Steward while continuing to execute RIP lifecycle
work.

## Knowledge Steward

Create `knowledge-steward-agent`. Do not repurpose `external-chatbot`; that
profile remains the bounded handbook-answering interface.

Assign `knowledge-steward-agent` to all falling-back agent steps in:

- `fireside-wiki-topic-develop`;
- `wiki-article-generate`;
- `wiki-topic-expand`.

Assign task `github-handbook-issue-intake` to `knowledge-steward-agent`.

Review `lore-entry-draft-review-publish` separately. The proposed split is:

| Steps | Executor |
| --- | --- |
| `intake`, `arc-plan`, `draft`, `revise`, `publish-prep`, `publish` | `knowledge-steward-agent` |
| `media-plan`, `generate-images` | `brand-agent` |
| `seo-aeo-validation` | `brand-agent`, unless the Knowledge profile receives the publication-audit capability |

## Participation Steward

Applied on 2026-09-01: created workspace-owned
`participation-steward-agent` and assigned it as the workflow default for every
agent step in:

- `monthly-share-distro-proposal`;
- `weekly-participation-admin-snapshot`.

Assigned these tasks explicitly to `participation-steward-agent`:

- `monthly-share-distro-proposal-request`;
- `weekly-participation-admin-snapshot`.

The human review gate before `submit-onchain` remains mandatory. Both schedules
remain disabled. The post-migration accountability audit reports all eight agent
steps as `workflow-default`, both tasks as `task-explicit`, and no remaining
Participation Admin fallbacks.

## Platform Operations

These are intentional Control Plane operations. Replace implicit fallback with
an explicit `admin-agent` assignment for every agent step in:

- `workflow-repair-loop`.

Make `admin-agent` explicit for these tasks:

- `weekly-state-cleanup-review`;
- `workflow-repair-loop-every-30m`;
- `workflow-repair-loop-weekday-2h`;
- `workflow-repair-loop-weekend-daily`.

This removes fallback ambiguity without pretending Control Plane repair belongs
to a domain-specific operating profile.

## Software Delivery

Assign `codegen-agent` to:

- workflow `change-request-default`, step `triage`;
- workflow `existing-pr-review`, step `implement`.

The remaining change-request steps already explicitly use Codegen, Verification,
and Code Review built-in profiles.

## Application Order

1. Completed 2026-09-01: create and verify `participation-steward-agent`, then
   migrate Participation.
2. Create narrowly scoped Accounting and Knowledge Steward profiles.
3. Apply clear existing-profile replacements for BizDev, Community Operations,
   Governance, Software Delivery, and unambiguous Brand definitions.
4. Convert intended Platform Operations use to explicit `admin-agent`.
5. Review mixed Brand/Sync/Knowledge workflows step by step.
6. Run the accountability audit and Prism Doctor after each batch.
7. Preserve completed run history; apply executor changes only to new definition
   versions and future runs.

## Migration Checks

For each batch:

- preview profile and definition changes before confirmation;
- keep schedules disabled unless enablement is separately approved;
- preserve gates and approval requirements;
- read back the updated profile, workflow, task, and domain assignment;
- verify effective executor resolution for every runnable agent step;
- report remaining Admin fallbacks and unresolved executors;
- do not rewrite historical run attribution.
