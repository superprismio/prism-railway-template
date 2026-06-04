# Durable Agent Run Model

Status: draft

## Purpose

Prism has several ways to run Codex-backed work: Prism Console, change request
workflows, task-runner jobs, hook triggers, and communication adapter commands.
These surfaces currently share parts of the same response handler, but each one
also owns a different piece of run state. That makes browser timeouts, retries,
late completions, and gate approvals hard to reason about.

This spec proposes one durable run model for long-running agent work.

## Goals

- make every long-running operation return quickly with a durable run id
- keep browser, Discord, hook, and task retries from starting duplicate work
- make workflow transitions compare-and-set against the state that existed when
  the run started
- ignore late completions from canceled, superseded, or stale runs
- keep delivery to Discord, Telegram, or browser UI separate from workflow
  mutation
- provide a single run timeline operators can inspect

## Non-Goals

- do not replace Codex Runtime's internal job API in the first slice
- do not redesign workflow manifests
- do not couple request state to Discord channels, Portal records, or task keys
- do not make adapter delivery success determine workflow success

## Current Run Surfaces

### Prism Console

The browser posts to `/admin/console/jobs`. The site creates an
`agent_response_jobs` row, then starts an in-process job that calls the shared
response handler. The browser polls the job row.

This protects the browser request from direct Codex Runtime timeouts, but the
job still runs inside the site process and still shares workflow mutation logic
with request workflows.

### Change Requests

Requests can be created from the admin UI, Prism Console, hooks, tasks, or
service callers. Creation may autostart the workflow by calling
`/agent/responses`. Continue and approve actions also call the shared response
handler.

The shared handler currently starts executions, calls Codex Runtime, records
messages, and mutates workflow state.

### Tasks

The task-runner service owns in-memory task state and writes task-run rows back
to the site. Workflow-runner tasks create change requests and can autostart or
continue request workflows by calling `/agent/responses`.

### Hooks

Hook triggers translate external events into Prism state. They may create a
change request and currently can autostart the request workflow. Hook run
visibility is separate from request execution visibility.

### Communication Adapters

Discord and Telegram commands should behave as ingress and egress layers. They
can create requests, approve gates, or ask questions, but they should not own
workflow execution state. They also need fast acknowledgement, idempotency, and
best-effort delivery of status updates.

## Target Model

All long-running work should be represented as a durable run:

```text
agent_run
  id
  kind: console | workflow_step | task | hook | adapter_command
  status: queued | running | succeeded | failed | canceled
  idempotency_key
  request_id
  workflow_run_id
  workflow_step_key
  expected_workflow_step_key
  task_key
  hook_key
  session_id
  actor/source metadata
  input
  result
  trace
  error
  timestamps
```

Every surface follows the same pattern:

1. validate the caller and input
2. create or reuse a durable run by idempotency key
3. return `202 Accepted` with the run id
4. execute the run asynchronously
5. poll or subscribe to run status
6. reconcile results only if expected state still matches

## Workflow State Rules

- A workflow action such as `approved` is only valid on a gate step.
- A run that starts on step `X` may only complete step `X` if the workflow is
  still on `X`.
- A run may only complete if its execution row is still active.
- Terminal workflow states are final unless an explicit reopen operation creates
  a new run context.
- Late completions from canceled or stale runs should record
  `agent.completion_ignored` and must not mutate workflow state.
- Delivery failures must not roll back successful workflow mutation.

## Hook Trigger Rules

Hook triggers should fit the same model:

```text
external event -> hook run -> optional request created -> workflow step run
```

The hook run owns event validation, matching, artifact creation, and request
creation. The request workflow owns triage, approval, implementation, review,
and terminal state.

## Communication Adapter Rules

Adapter-originated requests and approvals should also enqueue durable runs.

- use idempotency keys from platform, channel/thread, and message or interaction
  ids
- acknowledge slash commands before Codex work begins
- keep source refs, but do not use Discord threads/channels as workflow state
- reject approval commands unless the current workflow step is a gate
- record delivery failures separately from workflow execution
- ignore bot self-output unless a command explicitly opts in

## First Slice Checklist

- [x] Reject workflow actions on non-gate steps.
- [x] Ignore late completions when the workflow is no longer on the execution's
  expected step.
- [x] Preserve execution results and trace even when workflow mutation is
  ignored.
- [x] Store workflow-step active-run idempotency in execution metadata as a
  compatibility layer for future `agent_runs.idempotency_key`.
- [x] Reuse an active execution response when the same request, workflow run,
  step, and action are submitted again.
- [ ] Add tests or focused validation for stale completion behavior.
- [ ] Confirm Prism Console, request autostart, task workflow-runner, hook
  autostart, and Discord approval routes all pass through the same guard.

## Later Checklist

- [x] Introduce a general `agent_runs` table.
- [x] Link request workflow-step executions to `agent_runs` for observability
  without changing the executor.
- [x] Add service/admin read routes for inspecting agent runs.
- [ ] Move Prism Console jobs onto `agent_runs`.
- [ ] Move request autostart and continue actions onto `agent_runs`.
- [ ] Move hook trigger execution records onto `agent_runs` or link hook runs
  to agent runs.
- [ ] Have task-runner enqueue site-owned runs instead of calling
  `/agent/responses` directly for workflow execution.
- [ ] Add idempotency keys for adapter commands, hooks, task runs, and request
  workflow steps.
- [ ] Add a unified run detail view in the admin UI.
- [ ] Add a cleanup/reconciliation task for old active runs.
