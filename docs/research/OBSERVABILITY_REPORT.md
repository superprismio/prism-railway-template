# Prism Observability Exploration Report

Date: 2026-06-23

This report maps where Prism currently records what it is doing across the
Railway template services, then outlines gaps and opportunities for better
observability. It focuses on logs, metrics, traces, health checks, and durable
activity records that could later feed the site UI, Memory, agents, or outbound
channels such as Discord.

## Executive Summary

Prism already has a solid observability spine in the `site` service:
`agent_runs` is the shared durable record for console work, workflow steps,
tasks, and hooks. Request workflows add a higher-level `workflow_events`
timeline. Task and hook runs have domain-specific tables linked back to
`agent_runs`, and request artifacts/external refs preserve outputs created
during work.

The biggest opportunity is to turn these scattered signals into a consistent
activity model. Today, durable run records, workflow events, Prism Memory JSONL
activity, Railway stdout logs, and service health endpoints all exist, but they
do not share one event envelope, correlation id, severity model, or query
surface. Runtime traces are useful but compact and bounded; service logs are
unevenly structured; metrics are mostly implicit and must be derived by querying
tables or parsing logs.

## Services Reviewed

- `services/site`: admin UI, app API, SQLite runtime state, workflows, tasks,
  hooks, sessions, artifacts, and the durable `agent_runs` queue.
- `services/codex-runtime`: Express service that runs Codex CLI, manages
  runtime response jobs, and emits per-run trace events.
- `services/task-runner`: scheduled and manual task execution, task history,
  task output delivery, and structured JSON process logs.
- `services/source-adapter`: Discord/Telegram communication adapter, message
  collection, output delivery, Discord prompt bridge, voice recording, and
  adapter health.
- `services/prism-memory`: FastAPI memory/knowledge API, ops endpoints,
  activity JSONL logs, audit logs, and access logs.
- `services/prism-trigger`: one-shot cron-style HTTP trigger wrapper.

## What Is Happening Now

### Site: Durable Agent Runs

The `site` service owns the central run ledger. The `agent_runs` table stores:

- run id, kind, status, source, lane, priority, idempotency key
- links to request, workflow run, workflow step, task, hook, or session
- input JSON, result JSON, trace JSON, error message
- queue/claim/lease fields and started/finished timestamps

Relevant code:

- `services/site/src/lib/app-core/migrations/021_agent_runs.ts`
- `services/site/src/lib/app-core/migrations/025_agent_run_queue_fields.ts`
- `services/site/src/lib/app-core/repository.ts`
- `services/site/src/app/agent/runs/route.ts`
- `services/site/src/app/admin/agent-runs/route.ts`

The queue model is partially implemented. Workflow-lane runs are enqueued into
`agent_runs`, claimed by a site dispatcher, assigned a lease, and executed. Queue
position is computed at read time. Stale running runs can be marked failed when
their lease expires.

Docs:

- `docs/architecture/api-execution-flow.md`
- `docs/architecture/durable-agent-run-model.md`
- `docs/features/agent-run-queue-concurrency.md`

### Site: Workflow Events

Workflow runtime state lives in `workflow_runs` and `workflow_events`.
`workflow_events` is append-only history for workflow start, gate decisions,
step changes, agent completion/failure, ignored late completions, cancellation,
and artifact creation.

Relevant code:

- `services/site/src/lib/app-core/migrations/008_workflow_runs.ts`
- `services/site/src/lib/app-core/repository.ts`
- `services/site/src/lib/response-route-handler.ts`
- `services/site/src/app/admin/change-requests/[id]/workflow-events/route.ts`

The request detail UI renders workflow events and recent agent runs in the
History area, including queue state, recent trace JSON, failure details, and
legacy execution records.

Docs:

- `docs/architecture/workflows.md`

### Site: Console Jobs And Agent Sessions

Prism Console creates both an `agent_runs` row and an `agent_response_jobs` row.
The browser polls `/admin/console/jobs/:id`, which now prefers `agent_runs` as
the returned job id. Console history is persisted as `agent_sessions` and
`agent_messages`.

Relevant code:

- `services/site/src/app/admin/console/jobs/route.ts`
- `services/site/src/app/admin/console/jobs/[id]/route.ts`
- `services/site/src/components/admin/codex-console.tsx`
- `services/site/src/lib/response-route-handler.ts`

The console UI shows recent trace snippets while a job runs, tolerates transient
poll errors, and restores active job/session ids from local storage.

### Site: Tasks And Hooks

Tasks and hooks each have a domain-specific run table, and current code also
links those rows to `agent_runs`.

Task run records store:

- task id/key, status, trigger source, started/finished timestamps
- result summary, error message
- input/output snapshots
- artifact refs

Hook run records store:

- hook id/key/name, workflow key, source, status
- request id/number/title when a request is created
- auto-start flags, payload JSON, result JSON, error message

Relevant code:

- `services/site/src/lib/app-core/migrations/006_tasks.ts`
- `services/site/src/lib/app-core/migrations/020_hook_runs.ts`
- `services/site/src/lib/app-core/migrations/022_run_links.ts`
- `services/site/src/lib/app-core/repository.ts`
- `services/site/src/components/admin/task-runner-workspace.tsx`
- `services/site/src/components/admin/hooks-workspace.tsx`

The admin UI has Recent Runs views for both Tasks and Hooks. These are useful
operational slices, but they are separate from a global activity view.

### Codex Runtime: Runtime Jobs And Traces

`codex-runtime` exposes:

- `GET /health`
- `GET /codex/health`
- `POST /v1/responses`
- `POST /v1/responses/jobs`
- `GET /v1/responses/jobs/:jobId`
- `GET /skills`

Runtime response jobs are currently held in memory, capped by pruning completed
jobs when the map grows past 100. Each job tracks status, input, response,
error, thread id, trace, created/started/finished timestamps.

The Codex process trace records bounded events such as:

- workspace clone/reuse/fetch/ready
- branch checkout/create/fast-forward
- git identity, commit, push, clean, push verification
- run started/completed/failed/timeout/empty response
- Codex thread started
- Codex item started/completed
- stderr lines and runtime error events

Trace entries are capped to the latest 40 events. The runtime emits plain
process logs for startup and Codex spawn, but its durable trace is returned to
the caller and then copied into `agent_runs.trace` by `site`.

Relevant code:

- `services/codex-runtime/src/index.ts`
- `services/codex-runtime/src/codex-runtime.ts`
- `docs/architecture/durable-codex-runtime-jobs.md`

### Task Runner: Structured Process Logs And Site Run Writes

`task-runner` has the most consistently structured stdout/stderr logs in the
Node services. It emits JSON events such as:

- `task-runner.started`
- `task.started`
- `task.succeeded`
- `task.failed`
- `task.site_register_failed`
- `task.site_fetch_failed`
- `task.site_run_create_failed`
- `task.site_run_update_failed`
- task config/build warnings

It also writes durable `task_runs` rows through `/agent/tasks/runs`, patches
them on completion, and copies output snapshots/traces into linked `agent_runs`.
Script-runner tasks bound stdout/stderr capture, record duration, truncation
flags, and stderr metadata in the task output snapshot.

Relevant code:

- `services/task-runner/src/index.ts`
- `services/site/src/app/agent/tasks/runs/route.ts`
- `docs/features/script-runner-tasks.md`

The health endpoint returns the runner disabled flag and per-task snapshots:
enabled, cron, status, last run, last success, last error, and next run.

### Source Adapter: Chat, Collection, Voice, Health

`source-adapter` exposes health and operational routes:

- `GET /health`
- `GET /capabilities`
- `GET /destinations`
- `GET /guild/channels`
- `POST /messages`
- `POST /attachments/fetch`
- `POST /attachments/resolve`
- `POST /sync`
- recording download/recovery routes

The health payload includes timestamp, config, checkpoint, data root, Discord
ready/user status, and voice transcription configuration. The Discord slash
command `/prism-health` adds channel permission checks in context.

The adapter persists some state to files under its data root, including Discord
collection checkpoints and Telegram chat/offset files. Discord prompt sessions
are persisted through `site` agent session/message APIs. Rate limiting is
currently in memory per adapter process.

Logging is mixed. There are many console logs/warnings/errors for Discord bridge
startup, command registration, mention handling, thread creation, access-policy
fallbacks, destination discovery, voice recording, recording recovery, audio
capture, transcription, Prism Memory ingest, and fatal errors. Some are
structured object arguments, but many are plain text strings.

Relevant code:

- `services/source-adapter/src/index.ts`
- `services/source-adapter/src/voice.ts`
- `docs/architecture/source-collection-routes.md`

### Prism Memory: Activity JSONL, Audit Logs, Access Logs

`prism-memory` has several durable event/log surfaces:

- `activity/activity.jsonl` for memory pipeline activity
- `knowledge/kb/activity/kb_activity.jsonl` for knowledge indexing/source
  activity
- `activity/ingest-log.jsonl` for compatibility message ingest batches
- `ops/audit/config-admin.jsonl` for ops/config admin audit entries

Memory activity records include timestamp, type, collector key, bucket, run key,
inputs, outputs, and metadata. Knowledge activity records include timestamp,
type, outputs, and metadata. The API exposes `/activity/recent` for recent
memory activity, with filters for event type, bucket, and collector key.

The FastAPI app also has an access-log middleware that logs method, path,
status, and duration in milliseconds through Python logging. Invalid API-key
attempts log a hash of the provided key and scopes.

Ops routes capture command stdout/stderr and return operation, command, cwd,
exit code, stdout, and stderr. Memory and knowledge ops append audit entries
with actor and reason headers when available.

Relevant code:

- `services/prism-memory/app/main.py`
- `services/prism-memory/prism_seed/default/code/community_memory/activity.py`
- `services/prism-memory/prism_seed/default/code/community_knowledge/activity.py`
- `services/prism-memory/prism_seed/default/code/community_memory_api/app.py`
- `services/prism-memory/prism_seed/default/code/community_memory_api/storage.py`

### Prism Trigger: One-Shot Cron Logs

`prism-trigger` logs JSON to stdout/stderr for each attempt, including attempt
number, URL, status, response body, error, and final failure summary. It is
small but reasonably observable through Railway logs.

Relevant code:

- `services/prism-trigger/main.py`

### Health Checks

Current health surfaces:

- `site`: `GET /api/health`, returns ok, service, auth mode, applied migration
  count, startup migrations.
- `codex-runtime`: `GET /health`, returns uptime, startedAt, codex binary/home,
  auth configured, runtime enabled, image generation enabled.
- `codex-runtime`: `GET /codex/health`, returns provider-level ok.
- `task-runner`: `GET /health`, returns disabled flag and task snapshots.
- `source-adapter`: `GET /health`, returns config, checkpoint, Discord status,
  data root, voice transcription state.
- `prism-memory`: `GET /health`, returns service and space.

Docs that reference these:

- `README.md`
- `docs/operations/railway-env-checklist.md`
- `docs/operations/template-deploy-runbook.md`
- `docs/user/concepts/railway-template-services.md`

## Current Gaps

### No Unified Event Envelope

Durable `agent_runs`, `workflow_events`, task/hook runs, Memory activity JSONL,
source-adapter logs, task-runner JSON logs, and runtime traces all use different
schemas. There is no common field set for:

- `event`
- `severity`
- `service`
- `environment`
- `requestId`
- `agentRunId`
- `workflowRunId`
- `taskRunId`
- `hookRunId`
- `sessionId`
- `runtimeJobId`
- `correlationId`
- `durationMs`
- `errorCode`
- redaction/sensitivity marker

This makes it harder to build one activity feed or route high-quality status
updates to Discord, Memory, or agents.

### Correlation Across Services Is Partial

`agentRunId` is propagated into workflow prompts and should be included when
creating artifacts, but the broader request path does not have a single
correlation id that flows through:

```text
site -> codex-runtime -> Codex CLI -> site artifact/API calls -> source-adapter/memory
```

Runtime jobs have their own ids, site jobs have ids, `agent_runs` have ids, and
Codex threads have ids. Those are valuable, but they are not consistently linked
in every service log or response.

### Metrics Are Mostly Implied

The system can derive useful metrics from existing state, but there is no
explicit metrics endpoint or rollup table. Examples that are currently derived
rather than first-class:

- runs started/succeeded/failed/canceled by kind/lane/source
- queue depth and queue wait time by lane
- run duration and Codex runtime duration
- runtime error rates by error code
- workflow step duration/failure rates
- task success/failure rate and last successful run age
- hook trigger success/failure rate
- source-adapter Discord prompt volume and rate-limit hits
- Memory ingest batch counts and ops duration
- artifact creation counts by kind and producer

### Traces Are Useful But Not End-To-End

`codex-runtime` produces good local trace events and `site` stores them in
`agent_runs.trace`, but this is not distributed tracing. There are no parent/child
span ids, no HTTP request spans, no cross-service trace propagation, and no
OpenTelemetry-style context.

The current trace is also bounded to the latest 40 runtime events, which is fine
for UI summaries but can lose early details on long runs.

### Runtime Job Durability Is Incomplete

`codex-runtime` response jobs are in-memory only. If the runtime restarts, active
job state and trace are lost. The docs already identify this as future work, and
the current site code partially addresses it by polling runtime jobs and copying
progress into site jobs.

The remaining gap is runtime-side persistence and recovery for active jobs,
including cancel support and job retention policy.

### Site Process Logs Are Sparse

Compared to `task-runner`, the `site` service relies heavily on durable DB state
and API JSON responses. That is good for product observability, but process logs
are sparse and inconsistent. Important events such as workflow enqueue, claim,
completion, ignored stale completion, console job start/fail, and autostart
failure could also emit structured logs with ids.

### Source Adapter Logs Are Inconsistent

The adapter has many useful console messages, especially around Discord and
voice, but they are mostly plain strings and object arguments rather than a
consistent JSON event schema. This limits machine parsing in Railway logs and
makes it harder to compute event counts or extract correlated failures.

### Health Checks Are Mostly Liveness, Not Readiness

Health endpoints confirm the services are up, but readiness/config checks vary:

- `codex-runtime /health` includes auth/config status.
- `source-adapter /health` includes useful config and checkpoint data.
- `task-runner /health` includes task snapshots.
- `prism-memory /health` only reports service and space.
- `site /api/health` reports migration count but not DB writability, data root,
  runtime connectivity, adapter connectivity, or Memory connectivity.

### No Central Activity Feed

The admin UI has several local run/history surfaces, but there is no global
activity view that aggregates active and recent work across console, workflows,
tasks, hooks, adapters, Memory ops, and health anomalies.

The docs already mention this possibility in the durable runtime job plan, but
the current implementation is still per-feature.

### Logs May Leak Or Overexpose Operational Context

Runtime traces include workspace paths, repo URLs, branch names, stderr excerpts,
and git identity. Memory ops return stdout/stderr. Source adapter logs include
Discord guild/channel/session/user ids. These are useful, but any future UI,
Memory handoff, or Discord reporting layer needs redaction and audience-aware
filtering.

## Opportunities To Improve Logging And Observability

### 1. Standardize A Prism Event Envelope

Add a small shared event shape for service logs and durable activity records.
This does not need a full logging framework first; a helper per language would
be enough.

Suggested fields:

```json
{
  "ts": "2026-06-23T12:00:00.000Z",
  "level": "info",
  "service": "site",
  "event": "agent_run.claimed",
  "correlationId": "cr-43:run-...",
  "requestId": "...",
  "requestNumber": 43,
  "agentRunId": "...",
  "workflowRunId": "...",
  "workflowStepKey": "implement",
  "taskKey": null,
  "hookKey": null,
  "sessionId": "...",
  "runtimeJobId": "...",
  "durationMs": 1234,
  "status": "running",
  "errorCode": null,
  "message": "Claimed workflow run",
  "meta": {}
}
```

Start with high-value lifecycle events:

- `agent_run.created`
- `agent_run.queued`
- `agent_run.claimed`
- `agent_run.progress`
- `agent_run.succeeded`
- `agent_run.failed`
- `agent_run.canceled`
- `workflow.step_changed`
- `workflow.gate_approved`
- `task.started`
- `task.succeeded`
- `task.failed`
- `hook.triggered`
- `memory.ops.started`
- `memory.ops.succeeded`
- `adapter.prompt.received`
- `adapter.prompt.succeeded`
- `adapter.prompt.failed`

### 2. Promote `agent_runs` Into The Main Observability Hub

`agent_runs` is the strongest existing spine. Extend it carefully instead of
creating a separate competing run system.

Useful additions:

- store `runtimeJobId` explicitly in `agent_runs.result` or a dedicated column
- store `correlationId` or compute one consistently
- store `lastProgressAt`
- store derived `durationMs`, `queueWaitMs`, and `runtimeDurationMs`
- store `errorCode` separate from full `errorMessage`
- store `actorType` and `actorId` for admin, service, Discord user, task, hook
- expose detail route `GET /agent/runs/:id`

### 3. Add A Unified Activity API

Build a read-only site route that aggregates the records already present:

```text
GET /agent/activity
GET /admin/activity
```

Initial sources:

- recent `agent_runs`
- active queued/running `agent_runs`
- recent `workflow_events`
- recent task runs
- recent hook runs
- recent console jobs

Later sources:

- Memory `/activity/recent`
- Memory ops audit entries
- source-adapter checkpoints/sync summaries
- runtime job summaries
- health-check anomalies

This route could power a site Activity tab, agent reports, and Discord summaries.

### 4. Add Metrics Rollups Before Adding A Metrics Stack

The quickest useful metrics can be SQL-derived from `site`:

- queue depth by lane/status
- active runs by lane/source/kind
- run outcomes by kind over 1h/24h/7d
- p50/p95 queue wait and run duration by lane/kind
- task last success age and failure streak
- hook trigger count and failure rate
- workflow step failure count by workflow/step

Expose them as:

```text
GET /agent/observability/summary
GET /admin/observability/summary
```

Later, add Prometheus/OpenTelemetry export if needed.

### 5. Improve Health Into Readiness

Keep existing liveness endpoints, but add deeper readiness fields:

Site:

- DB readable/writable
- data root writable
- applied and latest migration count
- active queued/running run counts
- stale running run count
- configured runtime/adapter/memory URLs present

Codex Runtime:

- `CODEX_HOME` writable
- workspace roots writable
- Codex binary executable/version
- active runtime job count
- completed job retention count

Prism Memory:

- data root writable
- active space config readable
- activity log readable/writable
- last memory activity timestamp
- last knowledge activity timestamp

Source Adapter:

- Discord gateway ready
- command registration status/time
- collection checkpoint age
- Telegram polling status
- in-memory prompt queue sizes

Task Runner:

- site API reachable
- configured tasks count
- due/overdue tasks count
- active run count

### 6. Make Source Adapter Logs Structured

Convert key adapter logs to JSON events with `service:"source-adapter"`.
Prioritize:

- Discord login/ready/disconnect
- command registration
- mention/slash prompt received
- prompt queued/started/succeeded/failed
- rate-limit blocked
- message send success/failure
- sync started/succeeded/failed with message counts
- voice recording start/stop/finalize/transcription/ingest events

Keep human-friendly messages in Discord replies, but make Railway logs
machine-readable.

### 7. Make Runtime Jobs Durable

Implement the already-documented durable runtime job direction:

- persist runtime jobs to SQLite or JSONL/files on the runtime volume
- expose cancel endpoint
- retain completed jobs for a configured window
- on runtime startup, mark interrupted active jobs as failed/expired with an
  explanatory trace event
- copy runtime job ids into `agent_runs`

This closes the largest reliability gap for long-running Codex work.

### 8. Preserve Full Traces Separately From UI Summaries

Keep `agent_runs.trace` compact for UI, but consider a separate artifact or
table for full trace history:

- `agent_run_events`
- `agent_run_trace_events`
- or a request artifact named `runtime-trace.json`

This would preserve early events from long runs while still letting the UI show
only the latest/highest-signal entries.

### 9. Connect Memory Activity And Site Runs

Memory already stores useful JSONL activity. A later bridge could periodically
pull or receive Memory activity summaries and attach them to the unified
activity feed.

Good candidates:

- Memory ops started/succeeded/failed
- ingest batches with source, batch id, accepted count
- digest/memory/seeds outputs
- knowledge docs added/changed/removed
- objective/signal updates

Avoid copying full Memory bodies into site logs. Store references, counts,
paths, and summaries.

### 10. Add Audience-Aware Reporting

For UI, agents, and Discord, define redaction levels:

- `operator`: full internal ids and trace excerpts
- `channel`: concise status, public request number/title, no secrets or raw
  stderr
- `memory`: durable event summaries, no transient stack traces unless explicitly
  promoted
- `agent`: enough ids and route hints to inspect further

This lets Prism reuse one activity source without leaking sensitive operational
details into public channels.

## Suggested First Implementation Slice

1. Add a small `logEvent` helper in each TypeScript service and use it for new
   lifecycle logs.
2. Add structured site logs around `agent_runs` enqueue, claim, success, failure,
   cancellation, and stale lease expiry.
3. Add `GET /agent/runs/:id` and `GET /agent/activity` backed by existing tables.
4. Add a SQL-derived observability summary for queue depth, active runs, recent
   failures, task health, and hook health.
5. Convert the highest-value source-adapter prompt and sync logs to JSON.
6. Add readiness fields to `site /api/health` and `prism-memory /health`.
7. Store runtime job id and last progress timestamp consistently in
   `agent_runs.result` while durable runtime job persistence is designed.

## UI And Agent Reporting Ideas For Later

- Admin Activity tab: active runs, recent failures, queued work, task health,
  hook triggers, Memory ops, and adapter health in one timeline.
- Request detail Observability panel: queue wait, duration, runtime job id,
  full trace artifact link, artifacts created by run, external refs created by
  run.
- Discord `/prism-status`: concise summary of active runs, failed runs, and
  unhealthy services for trusted channels.
- Scheduled observability digest task: post daily/weekly status to Discord and
  optionally write a Memory note.
- Agent self-check prompt: an agent can call `/agent/activity` and
  `/agent/observability/summary` before giving an operator a status report.
- Memory activity bridge: Memory can include Prism operational events in rolling
  memory without copying sensitive logs.

## Bottom Line

Prism already records the most important operational facts, especially in
`agent_runs`, `workflow_events`, `task_runs`, `hook_runs`, agent sessions, and
Memory activity JSONL. The next observability work should not start from a blank
page. It should normalize, correlate, and summarize the signals that already
exist, then add lightweight metrics/readiness surfaces and durable runtime job
recovery where the current design is still ephemeral.
