# Agent Run Queue And Concurrency

## Status

Planned / future.

## Problem

Prism can create many model-backed runs from different surfaces:

- Prism Console chat
- Discord and other communication adapters
- request workflow steps
- workflow chaining
- hooks
- task-runner jobs
- backfills and enrichment jobs

The `agent_runs` table already records `queued` and `running` states, but the
current workflow run enqueue path starts execution immediately in-process after
creating a queued run. When a workflow fans out into many child requests, Prism
can start many Codex Runtime sessions at once.

That creates avoidable risk:

- provider/model rate limits,
- Codex Runtime memory and process pressure,
- Railway/internal HTTP hot spots,
- GitHub and external API secondary limits,
- confusing operator UX when many related requests advance independently.

Chat has a different UX profile than long-running workflow requests. A queued
request can wait without much user impact if the UI says why. A chat reply should
not wait behind a batch of workflow-generated content jobs.

## Goals

- Make `agent_runs` the shared durable queue for model-backed work.
- Limit concurrent model-backed work globally and by lane.
- Reserve capacity for interactive chat so long-running workflow jobs do not
  starve user replies.
- Surface queued/running state clearly in request UI and chat UI.
- Preserve restart safety: queued runs should survive deploys, and stale running
  runs should be recoverable.
- Keep request workflow state separate from run queue state.

## Non-Goals

- Do not introduce a separate queue truth outside `agent_runs`.
- Do not make every background job model-backed.
- Do not solve full distributed scheduling across multiple site replicas in the
  first slice unless the deployment topology requires it.
- Do not make queue position a persisted field; compute it at read time.

## Concepts

### Run Lanes

Each agent run belongs to a lane. Initial lanes:

- `interactive`: Prism Console chat, Discord direct ask/reply, short user-facing
  commands.
- `workflow`: change request workflow steps, hook-created requests, task-created
  workflow requests, workflow chaining.
- `background`: backfills, memory enrichment, cleanup, scheduled maintenance.

Workflows can use leftover capacity, but they must not consume the capacity
reserved for interactive work.

### Concurrency

Suggested default settings:

```txt
PRISM_AGENT_RUN_INTERACTIVE_CONCURRENCY=1
PRISM_AGENT_RUN_WORKFLOW_CONCURRENCY=2
PRISM_AGENT_RUN_BACKGROUND_CONCURRENCY=1
PRISM_AGENT_RUN_GLOBAL_CONCURRENCY=3
```

The first implementation can start with lane caps and a global cap. Per-target
or per-workflow caps can come later.

Optional later settings:

```txt
PRISM_AGENT_RUN_TARGET_APP_CONCURRENCY=1
PRISM_AGENT_RUN_WORKFLOW_KEY_CONCURRENCY=1
PRISM_AGENT_RUN_MAX_QUEUE_AGE_MINUTES=1440
PRISM_AGENT_RUN_LEASE_SECONDS=1800
```

## Data Model

Extend `agent_runs` with queue/claim fields:

```ts
lane: "interactive" | "workflow" | "background"
priority: number
queuedAt: string
claimedAt: string | null
leaseExpiresAt: string | null
queueReason: string | null
```

Recommended defaults:

- `lane`: inferred from run kind/source.
- `priority`: higher for interactive runs, then request priority, then FIFO.
- `queuedAt`: set when the run is created.
- `claimedAt`: set when a dispatcher claims the run.
- `leaseExpiresAt`: set while running so stale work can be recovered.
- `queueReason`: optional explanation such as
  `workflow concurrency limit reached`.

Queue position should be computed when reading runs:

- count older queued runs in the same lane with equal or higher priority,
- optionally include global capacity pressure,
- do not persist the computed position.

## Queue Behavior

### Enqueue

All model-backed work creates an `agent_run` with `status: "queued"`.

The enqueue route should not directly call Codex Runtime or `handleResponsePost`
for workflow jobs. It should only create the durable run and nudge the dispatcher.

### Dispatch

A dispatcher claims queued runs when capacity is available:

1. Count active `running` runs by lane and globally.
2. Select eligible queued runs ordered by lane priority, run priority, and
   `queuedAt`.
3. Atomically claim a run by setting `status: "running"`, `claimedAt`, and
   `leaseExpiresAt`.
4. Execute the run.
5. Mark the run `succeeded`, `failed`, `canceled`, or `superseded`.

The first slice can run the dispatcher in the site service if the deployment is
single-replica. If multiple site replicas are expected, claiming must be atomic
and safe across processes.

### Recovery

On startup or periodic sweep:

- leave `queued` runs queued,
- mark stale `running` runs as failed or expired when `leaseExpiresAt` is past,
- avoid automatically rerunning non-idempotent steps unless the run input and
  idempotency key make that safe.

## Request UX

Queued state should be visible because operators otherwise read it as stuck.

Request row:

- show `Queued`, `Running`, `Waiting for review`, `Blocked`, or `Closed` from
  the latest active run and workflow state.

Request detail header:

- show lane and current queue state, for example:

```txt
Queued in workflow lane
Position 4
Waiting because workflow concurrency limit reached
```

Run history:

- show `lane`,
- `queuedAt`,
- `startedAt` / `claimedAt`,
- `finishedAt`,
- queue reason,
- computed queue position while queued.

Important workflow rule:

Queued is a run state, not a workflow step. A request should remain on its
current workflow step while the run waits. For example: "on Triage, queued to run
Triage."

## Chat UX

Interactive chat should have reserved capacity.

If chat is queued, the UI should show a lightweight inline message:

```txt
Queued briefly. 1 interactive run ahead.
```

If a chat run remains queued longer than expected, the UI can expose a link to
the run history or a diagnostic message. Chat should not wait behind workflow or
background runs unless the interactive lane itself is saturated.

## Workflow Chaining

Workflows that fan out into child requests should be able to create all child
requests quickly while letting the queue decide when each request runs.

Recommended behavior:

- child requests may be created with `autoStart: true`,
- auto-start creates queued `workflow` lane runs,
- dispatcher starts only as many child workflow runs as capacity allows,
- operators can still see all queued child requests.

For high-risk workflows, workflow authors can still choose `autoStart: false`
and add a human checkpoint before launching child runs.

## API Behavior

Create/continue routes should return immediately after enqueueing:

```json
{
  "ok": true,
  "queued": true,
  "agentRun": {
    "id": "...",
    "status": "queued",
    "lane": "workflow",
    "queuePosition": 3
  }
}
```

Read routes should include queue metadata for active runs:

- request detail route,
- request review route,
- agent run list route,
- task/hook run detail routes when linked to an agent run.

## Implementation Checklist

- [ ] Add `lane`, `priority`, `queued_at`, `claimed_at`,
      `lease_expires_at`, and `queue_reason` to `agent_runs`.
- [ ] Add repository helpers to compute queue position and claim the next run.
- [ ] Replace in-process workflow enqueue execution with durable enqueue plus
      dispatcher wakeup.
- [ ] Add dispatcher loop in site service or a dedicated runner process.
- [ ] Add lane/global concurrency env config with conservative defaults.
- [ ] Classify existing run sources into `interactive`, `workflow`, and
      `background`.
- [ ] Update request create/continue routes to return queued run metadata.
- [ ] Update Prism Console chat to show interactive queue state when saturated.
- [ ] Update request list/detail UI to show queued workflow runs and queue
      position.
- [ ] Update task-runner and hook run views to show linked agent run queue
      state.
- [ ] Add stale running-run recovery.
- [ ] Add validation for fan-out workflow creating many child requests.
- [ ] Add validation that interactive chat can run while workflow runs are
      queued.

## Open Questions

- Should the dispatcher live in the site service, task-runner, or a small
  dedicated worker?
- Should target apps get a default concurrency cap of `1` to avoid multiple
  simultaneous repo edits in the same target repository?
- Should request priority map directly to run priority, or should interactive
  lane always win regardless of request priority?
- How should cancellation behave for queued runs versus running runs?
- Should workflow chaining support an explicit batch/group id so related queued
  child requests can be displayed together?
