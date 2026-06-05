---
name: change-request-ops
description: Use this skill when Codex needs to pull the next or current Prism request, inspect request/workflow state, create requests, attach external refs, inspect agent runs, or continue workflow steps through the Prism Agent API.
---

Use this skill when Codex is operating on tracked change requests instead of freeform chat.

Required environment:

- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`
- optional `PRISM_TARGET_APP_ID`

Always send `x-service-token: $PRISM_AGENT_SERVICE_TOKEN`.

In deployed Prism instances, Codex Runtime usually receives `APP_API_BASE_URL` and `APP_API_SERVICE_TOKEN`, then exposes them to Codex as `PRISM_AGENT_API_BASE_URL` and `PRISM_AGENT_SERVICE_TOKEN`. If the `PRISM_*` names are missing, check the `APP_*` names before concluding the API is unavailable.

Do not use browser admin routes such as `/admin/board` from Codex Runtime. Runtime agents should use the `/agent/...` routes below with service-token auth. A `401` from a browser admin route usually means "wrong surface", not that the operation is impossible.

Core endpoints:

- `GET /agent/target-apps`
- `POST /agent/change-board/requests`
- `GET /agent/change-board/requests/next`
- `GET /agent/change-board/requests/current`
- `GET /agent/change-board/requests/by-number/:requestNumber/review`
- `GET /agent/change-board/requests/by-number/:requestNumber/artifacts`
- `POST /agent/change-board/requests/by-number/:requestNumber/workflow/continue`
- `GET /agent/change-board/requests/:id`
- `PATCH /agent/change-board/requests/:id`
- `GET /agent/change-board/requests/:id/external-refs`
- `POST /agent/change-board/requests/:id/external-refs`
- `GET /agent/change-board/requests/:id/artifacts`
- `POST /agent/change-board/requests/:id/artifacts`
- `GET /agent/change-board/requests/:id/artifacts/:artifactId/content`
- `GET /agent/runs`
- `GET /agent/change-board/requests/:id/executions`
- `GET /agent/change-board/requests/:id/deploy-plan`

Queue reads:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/next${PRISM_TARGET_APP_ID:+?targetAppId=$PRISM_TARGET_APP_ID}"
```

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/current${PRISM_TARGET_APP_ID:+?targetAppId=$PRISM_TARGET_APP_ID}"
```

Review a completed or stuck workflow run by request number:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/$REQUEST_NUMBER/review"
```

Use this endpoint when a user asks what happened to request `#10`, why a workflow got stuck, or what should improve next time. It returns the request, workflow definition, workflow run, agent runs, legacy executions, workflow events, artifacts, external refs, latest linked agent session, and agent messages. Review the agent runs and workflow events before recommending changes. Treat `legacyExecutions` as historical compatibility data only.

Inspect request artifacts by request number:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/$REQUEST_NUMBER/artifacts"
```

The by-number artifact route includes text, markdown, and JSON bodies by default. Use query params when narrowing the read:

- `?name=draft.md`
- `?artifactId=<artifact-id>`
- `?kind=markdown`
- `?includeContent=false`
- `?includeBinary=true`
- `?maxBytes=500000`

If a user asks whether artifacts were created for a request number, this endpoint is the first API to call. Do not claim the board is admin-password gated until the `/agent/.../by-number/...` routes have been tried with service-token auth.

Continue or approve a workflow by request number:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/$REQUEST_NUMBER/workflow/continue" \
  -d '{
    "comment": "'"$OPERATOR_COMMENT"'",
    "workflowAction": "approved",
    "autoContinueUntilGate": true
  }'
```

Use this route when a user approves a gate or asks to move a request along from Discord or another non-browser surface. It uses the normal workflow runner; do not manually patch `currentWorkflowStepKey` to bypass gates. `workflowAction` defaults to `approved`. If the next step is an agent step and `autoContinueUntilGate` is true, the workflow continues until it reaches a gate, checkpoint, or terminal step.

Create request pattern:

1. If the user is asking to create or open a tracked change request, do not write to Prism memory.
2. If the target app is unclear, list target apps first and either infer the best match or ask a focused follow-up.
3. Create the request through the internal change-board API.
4. Confirm the new request number, title, target app, and current workflow step back to the user.
5. By default, workflow-backed requests auto-start when their entry step is an agent step. Send `"autoStart": false` only when the user explicitly wants to create a request without running it.
6. If the entry step is a gate, the request waits for an operator decision.
7. The create response returns the created row as `request`; read `changeRequest` only as a compatibility fallback.
8. Valid `requestType` values are `bug`, `feature`, `issue`, `content`, `design`, `config`, and `ops`.

List target apps:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/target-apps"
```

Create tracked change request:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests" \
  -d '{
    "title": "'"$TITLE"'",
    "description": "'"$DESCRIPTION"'",
    "requestType": "'"$REQUEST_TYPE"'",
    "targetAppId": "'"$TARGET_APP_ID"'",
    "priority": "'"${PRIORITY:-normal}"'",
    "source": "chat",
    "autoStart": true
  }'
```

Start-of-run pattern:

1. Fetch `current`.
2. If `current.changeRequest` is null, fetch `next`.
3. Read `changeRequest`, `targetApp`, `targetEnvironment`, `deployPlan`, `latestAgentRun`, and `externalRefs`.
4. During triage, write substantive detail into `triageSummary` and `agentRecommendation` before routing the request onward.
5. Do not create `change_request_executions`. Workflow work is represented by `agent_runs` and should be started through the workflow continue route or request autostart.
6. Do not use legacy queue statuses such as `submitted`, `in-progress`, `ready-for-agent`, `awaiting-review`, `changes-requested`, `approved`, or `rejected`.
7. The current workflow step is stored in `workflow_runs.current_step_key` and exposed as `currentWorkflowStepKey`; use that field to understand where the request is.
8. Do not begin implementation, deployment, or agent-run work in the same turn that finishes triage unless the user explicitly says to continue immediately on an already reviewed request.

Patch request metadata:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID" \
  -d '{"triageSummary":"...","agentRecommendation":"..."}'
```

Attach external records when the request interacts with a live system outside Prism. Use this for GitHub issues, GitHub pull requests, Discord messages or threads, deployments, publishing targets, or DAO proposal pages. Do not leave these only in comments if later workflow steps need to inspect or sync them.

For the built-in repository-backed change request workflow, triage should create a GitHub issue in the target repository when repository access is configured and no GitHub issue external ref already exists. Do not create a duplicate issue when the request was imported from GitHub or already has an issue ref; attach the existing source issue instead.

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID/external-refs" \
  -d '{
    "provider": "github",
    "kind": "pull_request",
    "externalId": "42",
    "title": "'"$PR_TITLE"'",
    "url": "'"$PR_URL"'",
    "state": "open",
    "metadata": {
      "repo": "'"$GITHUB_REPO"'",
      "branch": "'"$BRANCH_NAME"'",
      "base": "main"
    }
  }'
```

When a request has a linked GitHub issue, leave concise issue comments for meaningful workflow state changes such as triage completed, PR opened, review changes requested, checks passing, or ready for final review. Do not spam the issue with every internal run update.

When implementation pushes a request branch and repository access is configured, create a pull request from the request feature branch into the target repository base branch. Then attach it as a GitHub `pull_request` external ref. If a PR ref already exists, reuse and update it instead of creating duplicates.

Checkpoint steps should use external refs as live lookup handles. For the default change request workflow, the `pr-review` checkpoint should inspect linked PR reviews, review comments, check status, and merge readiness. If changes were requested, summarize the specific fixes and recommend moving back to `implement`; if the PR is ready, recommend moving to `review`.

Create request artifacts for durable notes that later steps or humans need to inspect. Triage should write detailed fix notes as `triage-fix-notes.md`:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID/artifacts" \
  -d '{
    "kind": "triage-fix-notes",
    "name": "triage-fix-notes.md",
    "mimeType": "text/markdown",
    "encoding": "utf8",
    "content": "'"$TRIAGE_FIX_NOTES"'",
    "metadata": {
      "workflowStep": "triage"
    }
  }'
```

For richer triage updates, patch the request with both summary and suggested changes:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID" \
  -d '{
    "triageSummary": "'"$TRIAGE_SUMMARY"'",
    "agentRecommendation": "'"$SUGGESTED_CHANGES"'"
  }'
```

End-of-run pattern:

1. A triage pass should end by recording useful triage details and leaving the workflow/request ready for the next explicit workflow step.
2. An agent run should save durable artifacts/external refs needed by later steps. Workflow step movement is owned by the site workflow engine when running through `/agent/responses` or the workflow continue route.
3. Branch, commit, runtime trace, and failure details are recorded on `agent_runs.result` by the site runtime path. Do not patch legacy execution routes.
4. If work fails, let the agent run fail and leave the request on the current workflow step unless the workflow reaches a terminal step.

Rules:

- Treat the API as the source of truth.
- Re-read the request if the scope seems stale.
- If the user explicitly asks to create a change request, prefer the change-board API path over Prism memory writing.
- A chat-created request should start at the workflow entry step. It should not auto-run implementation unless the user or task explicitly requests an agent run.
- Do not use request `status`; request progress is owned by `workflow_runs.current_step_key` and exposed on request records as `currentWorkflowStepKey`.
- Keep summaries factual, but make triage useful enough that a human can understand the proposed edits without reopening the whole conversation.
- `agentRecommendation` should describe the suggested changes, touched areas, and intended outcome, not just say "ready for agent".
- Store machine-usable fields in request artifacts, external refs, or `agent_runs.result` instead of burying them in prose.
