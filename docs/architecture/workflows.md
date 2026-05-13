# Prism Workflows

Prism workflows are the long-term orchestration layer for requests, tasks, and agent-driven operating loops.

The first implementation is intentionally small:

- `site` owns the workflow registry.
- Workflow definitions use a thin JSON manifest plus markdown instructions.
- The request board is the first workflow-backed request type.
- The admin UI exposes a read-only Workflows tab.
- Tasks and workflows share the same `agentConfig` shape.
- Workflow runs/events are the runtime record; request status is a board projection.
- Requests may have no target repository. Target apps are optional context for workflows that need repository/deploy helpers.

## Naming

The product language should move toward **Requests** instead of **Change Requests**.

Today the database still contains `change_requests` because the existing board, routes, and Codex integration were already built around that table. The first workflow is `change-request-default`, which describes the current request lifecycle. A later migration can rename tables/routes if that becomes worth the churn.

## Workflow Definition

The workflow manifest is stored in the `workflows.definition_json` column. It is intentionally thin: enough structure for UI display and deterministic routing, but not a full behavior engine.

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
      "instructionPath": "workflows/change-request-default/steps/triage.md",
      "next": "approve-for-work"
    },
    {
      "key": "approve-for-work",
      "label": "Approve",
      "type": "gate",
      "next": "implement"
    }
  ]
}
```

The manifest answers deterministic app questions:

- what steps exist
- what order to render in the request detail view
- whether a step is an agent step, human gate, or terminal state
- where to find the markdown instructions for agent-facing steps
- whether the workflow requires a target repository

The markdown answers judgment-heavy agent questions:

- what the step is trying to accomplish
- what context matters
- what skills/scripts/files are relevant
- how to handle loops such as review sending work back to implementation

## External Refs

Requests can link to live records outside Prism through `request_external_refs`.

Use external refs for things that future steps, tasks, or humans may need to query again:

- GitHub issues
- GitHub pull requests
- Discord messages or threads
- deployment URLs
- publishing targets such as Ghost posts
- DAO proposal pages

Artifacts are for durable files produced by the workflow. External refs are for outside records with their own lifecycle.

Example:

```json
{
  "provider": "github",
  "kind": "pull_request",
  "externalId": "42",
  "title": "Add request external refs",
  "url": "https://github.com/example/repo/pull/42",
  "state": "open",
  "metadata": {
    "repo": "example/repo",
    "branch": "prism/request-12",
    "base": "main"
  }
}
```

Agents can attach refs through:

```text
POST /agent/change-board/requests/<request-id>/external-refs
```

Workflow prompts should stay descriptive:

- if no GitHub issue ref exists, create one and attach it
- if implementation opens a PR, attach a GitHub `pull_request` ref
- if the linked PR is merged, continue to post-merge cleanup
- if a support thread created the request, attach the source Discord message or thread

## Hooks

Hooks are on-demand workflow entrypoints. They sit beside tasks:

- tasks trigger work on a schedule
- hooks trigger work from an event or direct API call
- both can create workflow-backed requests

A hook row stores:

- `key` and `name`
- target `workflowKey`
- an enabled flag
- a small `requestTemplate`
- an `autoRun` policy
- last trigger timestamp

The trigger endpoint is:

```text
POST /agent/hooks/<hook-key>/trigger
```

The request template can use simple placeholders from the payload, plus `{{date}}`, `{{now}}`, and `{{payload}}`. Keep hooks thin. Put domain behavior in workflow markdown, skills, scripts, or adapters. If the hook is fed by another live system, include that system's stable identifiers and URLs in the payload so the workflow can attach external refs.

When a hook creates a request:

- request `source` is `hook:<hook-key>`
- the raw payload is saved as a `hook-payload.json` artifact with kind `hook-payload`
- auto-run starts from the workflow entrypoint when `autoRun.enabled` is true

Hooks default to service-token auth in the first implementation. The browser admin UI exposes a Hooks tab for inspection, enable/disable, deletion of custom hooks, endpoint copy, and manual test triggering.

See `docs/architecture/hooks.md` for the full hook model.

## Default Request Workflow

The built-in request workflow uses `workflow_runs.current_step_key` as the source of truth. Request `status` remains only a coarse board projection for lists and badges.

The UI renders this as:

- a read-only Workflows tab for registered workflow definitions
- a workflow-driven subway map in the request detail panel
- a workflow step label plus raw status on each request row
- workflow events in the request History tab

Existing request rows are not deleted by the workflow migration. A workflow run is created when a request is created or first touched by the workflow-aware code path. Workflow events only exist from that point forward.

The default request workflow declares a repository target because it uses branch, commit, and deploy-preview helpers. Other workflows can omit a repository target and produce artifacts, Discord notifications, summaries, or other outputs through step instructions.

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
- `request_artifacts`: files produced by workflow steps, with metadata in SQLite and file bytes stored under the site data volume.

The request `status` remains a coarse board projection for lists and badges. It should not be treated as the workflow engine. The workflow run's `current_step_key` is the source of truth.

## Request Artifacts

Workflow steps can save durable outputs as request artifacts. Use artifacts for drafts, image prompts, generated images, publish packets, JSON plans, or any output that should remain visible after an agent run finishes.

Artifacts are stored under the site service data root:

```text
/data/workflow-artifacts/
  requests/
    <request-id>/
      <artifact-id>-<filename>
```

The `request_artifacts` table stores the request link, artifact kind, name, MIME type, size, metadata, and relative storage path. The request detail UI shows artifacts in the **Artifacts** tab and serves file content through authenticated admin routes.

Codex Runtime or another internal service can create an artifact with:

```http
POST /agent/change-board/requests/<request-id>/artifacts
Content-Type: application/json
x-service-token: <internal-service-token>

{
  "kind": "markdown",
  "name": "draft.md",
  "mimeType": "text/markdown",
  "content": "# Draft\n...",
  "encoding": "utf8",
  "metadata": {
    "workflowStep": "draft"
  }
}
```

Use `encoding: "base64"` for images or other binary files. Creating an artifact also records an `artifact.created` workflow event when the request has a workflow run.

List artifacts:

```http
GET /agent/change-board/requests/<request-id>/artifacts
```

Read artifact content:

```http
GET /agent/change-board/requests/<request-id>/artifacts/<artifact-id>/content
```

For Codex-friendly retrieval, request JSON from the raw content route:

```http
GET /agent/change-board/requests/<request-id>/artifacts/<artifact-id>/content?format=json
```

Codex can also retrieve request artifacts by visible request number without first resolving internal ids:

```http
GET /agent/change-board/requests/by-number/<request-number>/artifacts
GET /agent/change-board/requests/by-number/<request-number>/artifacts?name=draft.md
GET /agent/change-board/requests/by-number/<request-number>/artifacts?kind=markdown&includeContent=true
```

The by-number route returns artifact metadata plus text/json/markdown bodies as JSON. Binary bodies are omitted by default; pass `includeBinary=true` to receive base64 content.

## Custom Workflow Registration

Instance-authored workflows can live on the site volume:

```text
/data/workflows/<workflow-key>/
  manifest.proposal.json
  workflow.md
  steps/
    <step-key>.md
```

Register a volume workflow with:

```http
POST /agent/workflows
Content-Type: application/json

{ "key": "<workflow-key>" }
```

The route reads `/data/workflows/<workflow-key>/manifest.proposal.json`, validates that all workflow and step instruction paths stay under `/data/workflows/<workflow-key>/`, then upserts the `workflows` row.

Codex Runtime usually cannot write the site service volume directly. For chat-authored workflows, send the files to the same endpoint:

```json
{
  "key": "blog-post-draft-review-publish",
  "manifest": {
    "key": "blog-post-draft-review-publish",
    "name": "Blog Post Draft Review Publish",
    "entrypoint": "intake",
    "workflowPath": "workflow.md",
    "steps": [
      {
        "key": "intake",
        "label": "Intake",
        "type": "agent",
        "instructionPath": "steps/intake.md",
        "next": "draft"
      }
    ]
  },
  "files": {
    "workflow.md": "# Blog Post Draft Review Publish\n...",
    "steps/intake.md": "# Intake\n..."
  }
}
```

The site writes `files` under `/data/workflows/<workflow-key>/`, normalizes manifest paths to the site volume, writes `manifest.proposal.json`, and registers the workflow. This is intentionally a direct write/register step, not a separate promotion lifecycle.

Run the current workflow step with the same response route the UI uses:

```http
POST /agent/responses
Content-Type: application/json
x-service-token: <internal-service-token>

{
  "input": [
    {
      "role": "user",
      "content": "Run the current workflow step for request #3 using the request description and workflow step instructions."
    }
  ],
  "linked_change_request_id": "<request-id>",
  "workflow_action": null
}
```

For a gate step, set `workflow_action` to `approved`, `changesRequested`, or another route key defined by the workflow manifest. The route records workflow events and execution rows.

## Execution Flow

The workflow-aware request flow is:

1. The admin UI sends `/admin/responses` with the operator prompt and optional `workflow_action`; service-token callers use `/agent/responses`.
2. `site` loads the request, workflow definition, workflow run, current step, and step markdown.
3. Gate actions are recorded as `workflow_events` and routed through the manifest.
4. Agent steps merge workflow-level and step-level `agentConfig`.
5. `site` calls `codex-runtime` with workflow metadata and the step instructions.
6. The response is recorded in `change_request_executions`.
7. The workflow run advances, workflow events are appended, and request `status` is updated as the board projection.

`change_request_executions` remains the record of concrete Codex runs: branch, commit, response text, runtime trace, deploy URL, and execution metadata. `workflow_events` is the higher-level workflow timeline.

The admin UI uses one `Continue` action. It runs the current agent step and then automatically continues through following `agent` steps until the workflow reaches a `gate`, `terminal` step, failure, or the server-side continuation cap.

Gate actions such as approval or requested changes use the same run-until-gate behavior after routing, so a review approval can continue into the next agent step without extra button presses while still stopping at the next human decision point.

## Migrations

Workflow state is split across two migrations:

- `007_workflows`: adds `tasks.agent_config_json`, `change_requests.workflow_key`, and the `workflows` registry table; seeds `change-request-default`.
- `008_workflow_runs`: adds `workflow_runs` and `workflow_events`.
- `009_nullable_request_targets`: makes `change_requests.target_app_id` nullable and marks the default workflow as repository-targeted.
- `010_request_artifacts`: adds request-linked workflow artifacts.

## Near-Term Path

1. Use workflow runs/events as the request engine.
2. Keep request status as the board projection.
3. Render registered workflows read-only in admin.
4. Let chat author workflow markdown and manifests after the default workflow has been exercised.
5. Expand workflow artifacts into richer previews when publish and image generation workflows need them.

The `prism-workflow-author` skill documents the authoring style for new workflow markdown and manifests.
