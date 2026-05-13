---
name: prism-workflow-author
description: Use this skill when Codex is asked to create, update, or reason about Prism request workflows, workflow steps, gates, manifests, or workflow instruction files.
---

Use this skill to author Prism workflows in the style expected by the site service.

Prism workflows are markdown-first and DB-indexed:

- Workflow and step instructions are human/agent-authored markdown.
- The workflow manifest is thin structure for UI display and deterministic routing.
- Workflow state, approvals, executions, and event history belong in the DB, not markdown.

## Storage

Built-in workflows live in the template repo:

```text
services/site/workflows/<workflow-key>/
  workflow.md
  steps/
    <step-key>.md
```

Instance custom workflows should use the site-owned volume when that API/storage path exists:

```text
/data/workflows/<workflow-key>/
  manifest.proposal.json
  workflow.md
  steps/
    <step-key>.md
```

Do not store runtime approval state, current step, retry state, or execution history in workflow files.

Codex Runtime should not assume it can write the site service volume directly. To install a chat-authored workflow, call the site workflow endpoint with the manifest and files:

```json
{
  "key": "example-workflow",
  "manifest": {
    "key": "example-workflow",
    "name": "Example Workflow",
    "entrypoint": "triage",
    "workflowPath": "workflow.md",
    "steps": [
      {
        "key": "triage",
        "label": "Triage",
        "type": "agent",
        "instructionPath": "steps/triage.md"
      }
    ]
  },
  "files": {
    "workflow.md": "# Example Workflow\n...",
    "steps/triage.md": "# Triage\n..."
  }
}
```

Use `POST /admin/workflows` with admin auth or internal service auth. The site service writes the files under `/data/workflows/<workflow-key>/`, normalizes manifest paths, and registers the workflow.

To run a request workflow step from another service, use the site response route with internal service auth:

```json
{
  "input": [
    {
      "role": "user",
      "content": "Run the current workflow step using the request context and step instructions."
    }
  ],
  "linked_change_request_id": "<request-id>",
  "workflow_action": null
}
```

Send that body to `POST /admin/responses`. For gate steps, set `workflow_action` to the route key, such as `approved` or `changesRequested`.

Workflow steps should save durable files through the request artifact API instead of leaving important outputs only in chat text. Use artifacts for drafts, image prompts, generated images, publish packets, JSON plans, or any step output that future steps or humans should inspect.

```json
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

Send that body to `POST /api/internal/change-board/requests/<request-id>/artifacts` with internal service auth. Use `encoding: "base64"` for image or other binary content. Artifacts are owned by the site service, stored under `/data/workflow-artifacts`, listed on the request Artifacts tab, and recorded as `artifact.created` workflow events.

When a later workflow step needs prior artifact bodies, read them through the site API instead of guessing volume paths:

```http
GET /api/internal/change-board/requests/by-number/<request-number>/artifacts
GET /api/internal/change-board/requests/by-number/<request-number>/artifacts?name=draft.md
GET /api/internal/change-board/requests/<request-id>/artifacts/<artifact-id>/content?format=json
```

The by-number route returns artifact metadata plus text/json/markdown bodies. Binary content is omitted by default unless `includeBinary=true` is passed.

Use external refs for live records outside Prism. Do not store GitHub issues, GitHub pull requests, Discord messages, deployment URLs, CMS posts, or DAO proposal links only in comments or artifacts when they need later lookup or sync.

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

Send that body to `POST /api/internal/change-board/requests/<request-id>/external-refs` with internal service auth. Common refs include `github` `issue`, `github` `pull_request`, `discord` `message`, `railway` `deployment`, and publishing targets such as `ghost` `post`. Workflow steps can then say: if no GitHub issue ref exists, create one and attach it; if a linked PR is merged, move to post-merge cleanup.

## Manifest Rules

The manifest is stored in `workflows.definition_json`. Keep it small.

Use it for:

- `entrypoint`
- `workflowPath`
- optional target requirement, for example `{ "target": { "kind": "repository", "required": true } }`
- ordered `steps`
- step `key`
- step `label`
- step `type`
- `instructionPath`
- simple `next` or `routes` only when the UI/runtime needs deterministic routing
- shared `agentConfig`
- deterministic delegation policy in `agentConfig.delegation`

Do not put long prompts, implementation logic, scripts, or large prose in the manifest. Put those in markdown.

Do not require a target repository unless the workflow actually needs repo/deploy helpers. Requests can produce artifacts, Discord messages, summaries, or other outputs without a `targetAppId`.

Do not add workflow-specific hacks for board status, terminal status, auto-advance state, or legacy status mapping. The site workflow engine owns:

- current step state through `workflow_runs.current_step_key`
- request status projection for lists and badges
- terminal run state
- gate routing mechanics
- auto-continue behavior
- execution and workflow event history

Workflow markdown should define domain truth and evidence:

- what approval means for this workflow
- which comments are sufficient or insufficient for a human gate
- which artifacts prove the step is complete
- which external refs prove a live system action happened
- how to reconcile existing work before starting duplicate jobs
- what the next step should verify before writing or publishing

Put whether delegation is allowed in the manifest:

```json
{
  "agentConfig": {
    "delegation": {
      "allowed": true,
      "maxAgents": 3
    }
  }
}
```

Put when and how to delegate in the step markdown. Only enable delegation for steps that can safely split work into independent ownership areas. For request workflows, implementation steps may allow delegation; triage and human review gates usually should not.

Recommended manifest shape:

```json
{
  "key": "example-workflow",
  "name": "Example Workflow",
  "version": 1,
  "entrypoint": "triage",
  "workflowPath": "workflows/example-workflow/workflow.md",
  "agentConfig": {
    "runtime": "codex-runtime",
    "mode": "main-agent",
    "identity": "prism-workflow-agent",
    "skills": []
  },
  "steps": [
    {
      "key": "triage",
      "label": "Triage",
      "type": "agent",
      "instructionPath": "workflows/example-workflow/steps/triage.md",
      "next": "review"
    },
    {
      "key": "review",
      "label": "Review",
      "type": "gate",
      "routes": {
        "approved": "closed",
        "changesRequested": "triage"
      }
    },
    {
      "key": "closed",
      "label": "Closed",
      "type": "terminal"
    }
  ]
}
```

## Markdown Rules

`workflow.md` should describe:

- what the workflow is for
- how human gates work
- how loops/retries should be handled
- which state is durable DB state
- any important target/artifact conventions
- which domain evidence is required before a risky step can continue

Each `steps/<step-key>.md` should stay narrow and skill-like:

- describe the step outcome
- list the context the agent should use
- name relevant skills/scripts/files
- state what output should be returned
- state which durable artifacts should be written
- state which external refs should be attached or checked
- state idempotency/reconciliation rules for steps that call live systems
- state delegation rules when `agentConfig.delegation.allowed` is true
- avoid broad instructions that belong to the whole workflow

## Step Types

Use these step types:

- `agent`: Codex performs work for the step.
- `gate`: a human decision is required.
- `command`: a reviewed script or service command runs.
- `handoff`: work moves to a channel, target, or person.
- `subworkflow`: another workflow starts.
- `wait`: the workflow pauses for time or an external signal.
- `terminal`: the workflow is complete.

Only add `command`, `handoff`, `subworkflow`, or `wait` when the current product can represent or safely ignore them. For early workflows, prefer `agent`, `gate`, and `terminal`.

## Current Request Workflow

The current built-in request workflow is `change-request-default`.

Its workflow run `current_step_key` is the source of truth. Request `status` is only a coarse board projection for lists and badges.

When modifying current request behavior, preserve existing board semantics unless the user explicitly asks for a migration.

## Authoring Checklist

When creating or changing a workflow:

1. Use lowercase kebab-case workflow and step keys.
2. Update `workflow.md`.
3. Add or update each relevant `steps/<step-key>.md`.
4. Update the manifest `steps[]` order and deterministic `next` / `routes`.
5. Keep agent instructions in markdown, not JSON.
6. Keep state and approvals in DB-backed request/workflow records.
7. Call out any required skills, scripts, env vars, or adapter capabilities.
8. Return a concise summary of changed files and expected UI/status behavior.
