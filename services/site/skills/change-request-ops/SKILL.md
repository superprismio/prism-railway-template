---
name: change-request-ops
description: Use this skill when Codex needs to pull the next or current Prism change request, inspect request state, update board status, or create and update execution records through the Prism Agent API.
---

Use this skill when Codex is operating on tracked change requests instead of freeform chat.

Required environment:

- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`
- optional `PRISM_TARGET_APP_ID`

Always send `x-service-token: $PRISM_AGENT_SERVICE_TOKEN`.

Core endpoints:

- `GET /api/internal/target-apps`
- `POST /api/internal/change-board/requests`
- `GET /api/internal/change-board/requests/next`
- `GET /api/internal/change-board/requests/current`
- `GET /api/internal/change-board/requests/by-number/:requestNumber/review`
- `GET /api/internal/change-board/requests/:id`
- `PATCH /api/internal/change-board/requests/:id`
- `GET /api/internal/change-board/requests/:id/external-refs`
- `POST /api/internal/change-board/requests/:id/external-refs`
- `GET /api/internal/change-board/requests/:id/executions`
- `POST /api/internal/change-board/requests/:id/executions`
- `PATCH /api/internal/change-board/executions/:executionId`
- `GET /api/internal/change-board/requests/:id/deploy-plan`

Queue reads:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/change-board/requests/next${PRISM_TARGET_APP_ID:+?targetAppId=$PRISM_TARGET_APP_ID}"
```

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/change-board/requests/current${PRISM_TARGET_APP_ID:+?targetAppId=$PRISM_TARGET_APP_ID}"
```

Review a completed or stuck workflow run by request number:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/change-board/requests/by-number/$REQUEST_NUMBER/review"
```

Use this endpoint when a user asks what happened to request `#10`, why a workflow got stuck, or what should improve next time. It returns the request, workflow definition, workflow run, executions, workflow events, artifacts, external refs, latest linked agent session, and agent messages. Review the timeline before recommending changes.

Create request pattern:

1. If the user is asking to create or open a tracked change request, do not write to Prism memory.
2. If the target app is unclear, list target apps first and either infer the best match or ask a focused follow-up.
3. Create the request through the internal change-board API.
4. Confirm the new request number, title, target app, and initial status back to the user.
5. Stop after creation unless the user explicitly asked you to also triage the request in this same turn.
6. Never create a request and start implementation in the same turn.

List target apps:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/target-apps"
```

Create tracked change request:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/change-board/requests" \
  -d '{
    "title": "'"$TITLE"'",
    "description": "'"$DESCRIPTION"'",
    "requestType": "'"$REQUEST_TYPE"'",
    "targetAppId": "'"$TARGET_APP_ID"'",
    "priority": "'"${PRIORITY:-normal}"'",
    "status": "submitted",
    "source": "chat"
  }'
```

Start-of-run pattern:

1. Fetch `current`.
2. If `current.changeRequest` is null, fetch `next`.
3. Read `changeRequest`, `targetApp`, `targetEnvironment`, `deployPlan`, `latestExecution`, and `externalRefs`.
4. During triage, write substantive detail into `triageSummary` and `agentRecommendation` before routing the request onward.
5. If operating on a queued request, create an execution record before changing code.
6. Use `triaging` only while actively triaging a request that has not been approved for execution yet.
7. Use `in-progress` only while actively making changes after a request is already `ready-for-agent`, `changes-requested`, or `awaiting-review`.
8. If the request started in `submitted`, `triaging`, or `needs-human-input`, the current turn is triage-only. End the turn after updating triage details and moving the request to `ready-for-agent`.
9. Do not begin implementation, deployment, or execution in the same turn that finishes triage unless the user explicitly says to continue immediately on an already reviewed request.

Create execution:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/change-board/requests/$CHANGE_REQUEST_ID/executions" \
  -d '{
    "status": "running",
    "actorType": "codex",
    "startedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
  }'
```

Update request status:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/change-board/requests/$CHANGE_REQUEST_ID" \
  -d '{"status":"in-progress"}'
```

Attach external records when the request interacts with a live system outside Prism. Use this for GitHub issues, GitHub pull requests, Discord messages or threads, deployments, publishing targets, or DAO proposal pages. Do not leave these only in comments if later workflow steps need to inspect or sync them.

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/change-board/requests/$CHANGE_REQUEST_ID/external-refs" \
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

For richer triage updates, patch the request with both status and suggested changes:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/change-board/requests/$CHANGE_REQUEST_ID" \
  -d '{
    "status": "ready-for-agent",
    "triageSummary": "'"$TRIAGE_SUMMARY"'",
    "agentRecommendation": "'"$SUGGESTED_CHANGES"'"
  }'
```

Update execution with results:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/api/internal/change-board/executions/$EXECUTION_ID" \
  -d '{
    "status": "completed",
    "branchName": "'"$BRANCH_NAME"'",
    "commitSha": "'"$COMMIT_SHA"'",
    "deployUrl": "'"$DEPLOY_URL"'",
    "summary": "'"$SUMMARY"'",
    "finishedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
  }'
```

End-of-run pattern:

1. A triage pass should end by moving the request to `ready-for-agent` once triage details are complete.
2. An execution pass should end by moving the request to `awaiting-review`, `changes-requested`, `approved`, or `closed` as appropriate.
3. Update the execution with branch, commit, deploy URL, summary, error, timestamps, and notable runtime trace details.
4. If work fails, record the failure on the execution and move the request back to the state it was in before the active run if possible.

Rules:

- Treat the API as the source of truth.
- Re-read the request if the scope seems stale.
- If the user explicitly asks to create a change request, prefer the change-board API path over Prism memory writing.
- A chat-created request should default to `submitted`, then stop at `ready-for-agent` after triage review. It should not auto-run implementation.
- Keep summaries factual, but make triage useful enough that a human can understand the proposed edits without reopening the whole conversation.
- `agentRecommendation` should describe the suggested changes, touched areas, and intended outcome, not just say "ready for agent".
- Store machine-usable fields in execution metadata instead of burying them in prose.
