# Prism Workflows

Prism workflows are the long-term orchestration layer for requests, tasks, and agent-driven operating loops.

The first implementation is intentionally small:

- `site` owns the workflow registry.
- Workflow definitions use a thin JSON manifest plus markdown instructions.
- The request board is the first workflow-backed request type.
- The admin UI exposes a read-only Workflows tab.
- Tasks and workflows share the same `agentConfig` shape.
- Workflow runs/events are the runtime record; request status is a board projection.

## Naming

The product language should move toward **Requests** instead of **Change Requests**.

Today the database still contains `change_requests` because the existing board, routes, and Codex integration were already built around that table. The first workflow is `change-request-default`, which describes the current request lifecycle. A later migration can rename tables/routes if that becomes worth the churn.

## Workflow Definition

The workflow manifest is stored in the `workflows.definition_json` column. It is intentionally thin: enough structure for UI, routing, and status mapping, but not a full behavior engine.

Agent-facing behavior lives in markdown files:

```text
services/site/workflows/change-request-default/
  workflow.md
  steps/
    triage.md
    implement.md
    review.md
```

Example:

```json
{
  "key": "change-request-default",
  "name": "Change Request",
  "version": 1,
  "entrypoint": "triage",
  "workflowPath": "workflows/change-request-default/workflow.md",
  "agentConfig": {
    "runtime": "codex-runtime",
    "mode": "main-agent",
    "identity": "prism-change-agent",
    "model": null,
    "reasoningEffort": null,
    "skills": ["change-request-ops", "target-deploy-ops"],
    "delegation": {
      "allowed": false,
      "maxAgents": 0
    }
  },
  "steps": [
    {
      "key": "triage",
      "label": "Triage",
      "type": "agent",
      "statusMap": ["submitted", "triaging", "needs-human-input"],
      "instructionPath": "workflows/change-request-default/steps/triage.md",
      "next": "approve-for-work"
    },
    {
      "key": "approve-for-work",
      "label": "Approve",
      "type": "gate",
      "statusMap": ["ready-for-agent"],
      "next": "implement"
    }
  ]
}
```

The manifest answers deterministic app questions:

- what steps exist
- what order to render in the request detail view
- which statuses map to which workflow step
- whether a step is an agent step, human gate, or terminal state
- where to find the markdown instructions for agent-facing steps

The markdown answers judgment-heavy agent questions:

- what the step is trying to accomplish
- what context matters
- what skills/scripts/files are relevant
- how to handle loops such as review sending work back to implementation

## Default Request Workflow

The built-in request workflow maps the old board statuses into workflow steps:

- `submitted`, `triaging`, `needs-human-input`: `triage`
- `ready-for-agent`: `approve-for-work`
- `in-progress`, `changes-requested`: `implement`
- `awaiting-review`: `review`
- `approved`, `rejected`, `closed`: `closed`

The UI renders this as:

- a read-only Workflows tab for registered workflow definitions
- a workflow-driven subway map in the request detail panel
- a workflow step label plus raw status on each request row
- workflow events in the request History tab

Existing request rows are not deleted by the workflow migration. A workflow run is created when a request is created or first touched by the workflow-aware code path. Workflow events only exist from that point forward.

## Step Types

The initial schema is descriptive and intentionally narrow. The default request workflow currently exercises `agent`, `gate`, and `terminal`.

Planned step types:

- `agent`: call Codex Runtime with prompt, context, skills, and target metadata.
- `gate`: wait for a human decision.
- `command`: run a reviewed script or service command.
- `handoff`: move work to a channel, target, or person.
- `subworkflow`: start another workflow run.
- `wait`: pause until an external signal, time, or status.
- `terminal`: close the run.

## Agent Config

`agentConfig` should become the shared execution vocabulary for workflows and tasks.

```json
{
  "runtime": "codex-runtime",
  "mode": "main-agent",
  "identity": "prism-task-agent",
  "model": null,
  "reasoningEffort": null,
  "skills": [],
  "tools": [],
  "workingDirectory": null,
  "delegation": {
    "allowed": false,
    "maxAgents": 0
  }
}
```

Tasks now have `tasks.agent_config_json`. The task runner merges skills from `instructionConfig.requestedSkills` and `agentConfig.skills` when it calls Codex Runtime.

Use `agentConfig.delegation` for deterministic delegation policy:

```json
{
  "delegation": {
    "allowed": true,
    "maxAgents": 3
  }
}
```

Put the judgment about when to delegate in the step markdown. For the default request workflow, only the `implement` step allows delegation. Triage stays single-agent so the initial read remains coherent, and review stays human-gated.

## Runtime State

Workflow definitions are files and manifests. Workflow execution state is DB-backed.

The runtime tables are:

- `workflow_runs`: one durable run per request, including current step and workflow key.
- `workflow_events`: append-only history for workflow start, step changes, gate decisions, agent start, agent completion, and agent failure.
- `change_request_executions`: concrete Codex execution records with branch, commit, trace, and summary.

The request `status` remains a board projection derived from the workflow step. It should not be treated as the workflow engine.

Manual status changes in the Advanced request controls are an escape hatch. They sync the workflow run by status and record a step-change event when the mapped step changes, but they can bypass explicit gate-decision events.

## Execution Flow

The workflow-aware request flow is:

1. The admin UI sends `/admin/responses` with the operator prompt and optional `workflow_action`.
2. `site` loads the request, workflow definition, workflow run, current step, and step markdown.
3. Gate actions are recorded as `workflow_events` and routed through the manifest.
4. Agent steps merge workflow-level and step-level `agentConfig`.
5. `site` calls `codex-runtime` with workflow metadata and the step instructions.
6. The response is recorded in `change_request_executions`.
7. The workflow run advances, workflow events are appended, and request `status` is updated as the board projection.

`change_request_executions` remains the record of concrete Codex runs: branch, commit, response text, runtime trace, deploy URL, and execution metadata. `workflow_events` is the higher-level workflow timeline.

## Migrations

Workflow state is split across two migrations:

- `007_workflows`: adds `tasks.agent_config_json`, `change_requests.workflow_key`, and the `workflows` registry table; seeds `change-request-default`.
- `008_workflow_runs`: adds `workflow_runs` and `workflow_events`.

## Near-Term Path

1. Use workflow runs/events as the request engine.
2. Keep request status as the board projection.
3. Render registered workflows read-only in admin.
4. Let chat author workflow markdown and manifests after the default workflow has been exercised.
5. Add custom workflow persistence under `/data/workflows` when workflow authoring graduates from built-in examples.

The `prism-workflow-author` skill documents the authoring style for new workflow markdown and manifests. There is not yet a custom workflow write API or workflow creation UI.
