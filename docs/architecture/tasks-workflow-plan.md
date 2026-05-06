# Tasks Workflow Plan

This document outlines the first implementation plan for scheduled and manual agent tasks that sit alongside Change Requests.

The goal is to support workflows like:

- daily community briefs
- weekly governance digests
- meeting-summary push tasks
- repo-backed content synthesis
- scheduled reporting from Prism Memory context

This is intentionally a second workflow family, not an extension of the CR status board.

## Product framing

Current workflow families:

- **Change Requests**
  - human-initiated
  - repo-backed
  - branch / PR oriented
  - review-heavy

- **Tasks**
  - scheduled or manual
  - prompt-driven
  - context in, output out
  - run-history oriented

Tasks should not be forced through:

- inbox
- triage
- ready
- working
- awaiting review

That state model fits CRs, not scheduled agent actions.

## First-slice scope

V1 should support:

- built-in scheduled jobs that replace the current fixed Railway cron services
- task definitions in the app
- scheduled and manual triggers
- Prism Memory as the primary context source
- Codex runtime as the initial execution backend
- Discord and Markdown artifact outputs
- run history and operator-visible status

The first implementation should start smaller than the full V1:

- one `task-runner` service
- built-in tasks for:
  - Discord sync
  - Prism Memory run
  - Prism Knowledge run
- manual run endpoints
- health/status output
- no site UI dependency yet

This proves the scheduling and execution plane before adding prompt-driven task definitions.

V1 should not support:

- arbitrary DAG builders
- generic code hooks
- per-task Railway cron services
- PR-style branch state machines
- broad external connector support

## Initial use cases

### Daily brief

- trigger: every morning
- input: Prism Memory activity from the last 24h
- instruction: generate a structured daily brief from a saved template
- outputs:
  - post to a Discord channel
  - optionally store a Markdown artifact

### Weekly governance digest

- trigger: weekly
- input:
  - Prism Memory governance activity
  - meeting summaries
  - optionally external proposal data already collected into Prism Memory
- outputs:
  - Discord post
  - Markdown artifact

### Meeting summary push

- trigger: manual or near-real-time
- input: recent meeting transcript / summary artifacts
- output: route the final summary to a target channel or repo path

## What belongs in Tasks vs Prism collectors

Keep this boundary clean.

### Prism collectors

Use collectors for:

- source ingestion
- deterministic external data collection
- Discord / meeting capture
- governance proposal ingestion
- docs / repo sync

Example:

- fetching new onchain DAO proposals should likely be a Prism collector
- then Tasks can synthesize reports from that collected context

### Tasks

Use Tasks for:

- synthesis
- summarization
- scheduled reporting
- artifact generation
- publishing / notification actions

## UI plan

Add a new top-level tab next to `Change Requests`:

- `Change Requests`
- `Tasks`
- existing console/settings remain as-is

### Tasks list view

Start with a table/list, not a kanban.

Suggested columns:

- name
- trigger
- inputs
- output
- status
- last run
- next run

### Task detail view

Each task should show:

- definition
- schedule
- prompt / template reference
- input sources
- output destinations
- run history
- last result
- manual run button

## Service boundaries

Do not put the scheduler in the Next.js request path.

### `site`

`site` owns:

- task definitions
- task UI
- run history
- task claiming / execution APIs

Task state should use the existing app SQLite DB owned by `site`. Do not create a second canonical task database in `task-runner`.

Candidate internal endpoints:

- `GET /api/internal/tasks/due`
- `POST /api/internal/tasks/:id/claim`
- `POST /api/internal/tasks/:id/run`
- `POST /api/internal/tasks/:id/complete`
- `POST /api/internal/tasks/:id/fail`

### `task-runner`

Add a new Railway worker service:

- name: `task-runner`

Responsibilities:

- poll for due tasks on a short loop
- claim tasks safely
- gather context from Prism Memory
- execute through Codex runtime
- write back run results to `site`

This should be one always-on worker, not one Railway cron per task.

The runner should remain restartable and mostly stateless. It may keep in-memory status for its own health endpoint, but canonical task definitions and run history belong to `site`.

### `prism-memory`

Prism Memory remains responsible for:

- context collection
- memory state
- knowledge state
- artifact storage

Tasks consume Prism Memory outputs. They do not replace Prism Memory pipeline behavior.

### `codex-runtime`

Codex runtime remains responsible for:

- task execution against model/runtime backends
- prompt handling
- output generation

V1 can use current Codex runtime interfaces. Later, task execution could be made more backend-pluggable.

## Data model

V1 can live in the existing app SQLite DB.

### `tasks`

Suggested fields:

- `id`
- `name`
- `description`
- `enabled`
- `trigger_type` (`manual`, `schedule`)
- `schedule_cron`
- `timezone`
- `input_config_json`
- `instruction_config_json`
- `output_config_json`
- `review_mode`
- `last_run_at`
- `next_run_at`
- `created_at`
- `updated_at`

### `task_runs`

Suggested fields:

- `id`
- `task_id`
- `status` (`queued`, `running`, `succeeded`, `failed`)
- `trigger_source` (`schedule`, `manual`, `api`)
- `claimed_at`
- `started_at`
- `finished_at`
- `input_snapshot_json`
- `output_snapshot_json`
- `result_summary`
- `error_message`
- `artifact_refs_json`
- `created_at`

## Task definition shape

The internal model should separate:

- trigger
- inputs
- instruction
- outputs

Do not collapse everything into one large prompt field.

### Example logical shape

```json
{
  "name": "Daily Brief",
  "enabled": true,
  "trigger": {
    "type": "schedule",
    "cron": "0 8 * * *",
    "timezone": "America/Denver"
  },
  "inputs": [
    {
      "type": "prism_memory",
      "scope": "recent_activity",
      "window_hours": 24
    }
  ],
  "instruction": {
    "template": "daily-brief-v1"
  },
  "outputs": [
    {
      "type": "discord_message",
      "channel_id": "1234567890"
    },
    {
      "type": "prism_artifact",
      "path_prefix": "briefs/daily"
    }
  ]
}
```

## Output types for V1

Start with:

- `discord_message`
- `prism_artifact`

Second wave:

- `github_file`
- `github_pr`

Do not treat every output repo as a `target app` in the CR sense.

There should eventually be a distinction between:

- **target apps**
  - interactive repos / deploy targets
  - current CR workflow

- **automation outputs**
  - content repos
  - report repos
  - Discord channels
  - other publication sinks

## Scheduling model

Use a polling worker.

### Runner loop

Every 60 seconds:

1. ask `site` for due tasks
2. claim one or more
3. execute
4. persist success/failure
5. sleep

Benefits:

- supports arbitrary user-defined schedules
- avoids dynamic Railway cron provisioning
- keeps execution state in the app

## Validation environment

Use `prism-stack` as the development and validation environment.

Reason:

- it is ejected
- it already runs the consolidated topology
- it is still tied to the template repo for easy branch-based service deploys
- it has real RaidGuild use cases

### Recommended branch deployment setup

For initial Tasks work, branch-deploy only:

- `site`
- `task-runner`

Leave these on stable `main` unless task implementation proves they need code changes:

- `prism-memory`
- `codex-runtime`
- `discord-adapter`
- cron services

## Railway impact

V1 likely adds one new service:

- `task-runner`

Do not update the published Railway template until:

- task schema is stable
- one or two real tasks run cleanly on `prism-stack`
- env requirements are known
- operator UX is validated

## Suggested implementation order

### Phase 0: built-in cron replacement

- add `services/task-runner`
- implement built-in fixed tasks for the existing cron jobs
- add `tasks` and `task_runs` tables in the existing `site` SQLite DB
- have `task-runner` register built-in tasks and write run history through `site` internal APIs
- deploy on `prism-stack` with all schedules disabled
- manually run each built-in task
- enable one schedule at a time
- disable old Railway cron services only after each replacement is verified

### Phase 1: design and storage

- add DB tables for tasks and task runs
- add repository/service methods in `site`
- add internal APIs for due/claim/complete/fail

### Phase 2: operator UI

- add `Tasks` tab
- add list/detail screens
- add create/edit form for one task type
- add manual run button

### Phase 3: runner

- add `task-runner` service
- implement polling loop
- implement due-task claiming and execution lifecycle

### Phase 4: first task type

- implement `daily brief`
- input: Prism Memory last 24h activity
- outputs:
  - Discord message
  - Prism artifact

### Phase 5: validation

- test on `prism-stack`
- run daily brief against real RaidGuild activity
- adjust prompt/template and operator UX

### Phase 6: template integration

- add `task-runner` to template
- document envs
- update runbook
- update deployment checklist

## Open questions

- Should task definitions live only in app DB, or also optionally in repo-local YAML later?
- Should `github_file` output commit directly to a repo, or open PRs by default?
- How much of task configuration should be exposed through chat vs admin UI?
- Should some task types require approval before publish, or is V1 fully headless?
- What internal execution interface should `task-runner` call on `codex-runtime` for non-CR jobs?

## Recommended first milestone

Build only this first:

- one `task-runner` service
- built-in `discord-sync`
- built-in `memory-run`
- built-in `knowledge-run`
- manual run endpoints
- health/status output

Then build:

- `Tasks` tab
- one `daily brief` task type
- Discord post output
- Prism artifact output

That is enough to prove the model without overbuilding the workflow system.
