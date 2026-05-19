# Prism Agent Instructions

Use these rules when running inside Codex Runtime for a Prism Railway Template instance.

## API Surfaces

- `/admin/*` is for browser/admin-session UI calls only.
- `/agent/*` is for Codex Runtime, task-runner, source-adapter, and other service-token callers.
- Do not use `/admin/*` with `x-service-token`.

If an `/admin/*` route returns `401`, do not ask for the admin password first. Check whether the equivalent `/agent/*` route exists.

## Auth

Prefer:

- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`

Fallbacks:

- `APP_API_BASE_URL`
- `APP_API_SERVICE_TOKEN`

Send service auth as:

```bash
-H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN"
```

## Common Agent Routes

- `GET /agent/tasks`
- `POST /agent/tasks`
- `POST /agent/tasks/:key/run`
- `GET /agent/tasks/runs`
- `POST /agent/tasks/runs`
- `GET /agent/skills`
- `POST /agent/skills`
- `GET /agent/workflows`
- `POST /agent/workflows`
- `GET /agent/hooks`
- `POST /agent/hooks`
- `GET /agent/hooks/:key`
- `PATCH /agent/hooks/:key`
- `DELETE /agent/hooks/:key`
- `POST /agent/hooks/:key/trigger`
- `POST /agent/responses`
- `GET /agent/target-apps`
- `GET /agent/change-board/requests/:id`
- `POST /agent/change-board/requests`
- `GET /agent/change-board/requests/next`
- `GET /agent/change-board/requests/current`
- `GET /agent/change-board/requests/by-number/:requestNumber/review`
- `GET /agent/change-board/requests/by-number/:requestNumber/artifacts`
- `GET /agent/change-board/requests/:id/artifacts/:artifactId/content`
- `GET /agent/site-content/branding`
- `PATCH /agent/site-content/branding`

For logo, title, brand name, or workspace label changes, use `/agent/site-content/branding`.

To manually execute an existing task from Codex Runtime, use:

```bash
curl -fsSL \
  -X POST \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/tasks/daily-memory-brief/run"
```

Do not use `/agent/tasks/runs` to start a task. That route is for task-runner run history and run-row recording.

For questions like "what happened to request #10?" or "what artifacts did request #10 create?", do not use `/admin/board`. Use:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/10/review"
```

To inspect artifact bodies by request number:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/10/artifacts"
```

The by-number artifact route includes text, markdown, and JSON bodies by default. Use query params like `?name=draft.md`, `?artifactId=<id>`, `?includeContent=false`, or `?includeBinary=true` when needed.

## Prism Skills

Prism skills are authoritative when a user asks for work covered by a listed skill. Use the skill instructions before probing local paths or browser admin routes.

Do not treat missing local files under `/data/codex/skills`, `/data/workflows`, or `/app` as a blocker for Prism-managed content. In deployed instances, skills and workflows are normally hosted by the site service and reached through `/agent/*`.

Examples:

- Workflow create/update/reasoning: use `prism-workflow-author`, then `GET /agent/workflows` or `POST /agent/workflows`.
- Task create/update/reasoning: use `prism-task-author`, then `GET /agent/tasks` or `POST /agent/tasks`.
- Skill create/update/reasoning: use `prism-skill-author`, then `GET /agent/skills` or `POST /agent/skills`.

## Output Adapter Delivery

Use the output adapter only when the user explicitly asks to send a message or a workflow/task needs immediate delivery.

Expected env:

- `COMMUNICATION_ADAPTER_BASE_URL`
- `COMMUNICATION_ADAPTER_TOKEN`

Resolve destinations:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/destinations"
```

Send a message:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/messages" \
  -d '{"destinationId":"<channel-id>","content":"Test message"}'
```

Do not use the site service token against adapter `/messages`.

## Instance-Owned Content

Custom skills and workflows are owned by the site service:

- Skills are saved through `/agent/skills`.
- Workflows are saved through `/agent/workflows`.
- Request artifacts are saved through `/agent/change-board/requests/:id/artifacts`.

Do not write custom Prism skills or workflows directly into `CODEX_HOME` unless the user explicitly asks for a temporary local experiment.

To create a custom skill, POST the full `SKILL.md` body to the site service:

```json
{
  "name": "monthly-security-audit",
  "content": "---\nname: monthly-security-audit\n..."
}
```

To create a custom workflow from Codex Runtime, POST the complete manifest and markdown files to the site service. Do not write `/data/workflows/...` locally from Codex Runtime; that is the site service volume.

```json
{
  "key": "monthly-security-audit",
  "manifest": {
    "key": "monthly-security-audit",
    "name": "Monthly Security Audit",
    "entrypoint": "intake",
    "workflowPath": "workflow.md",
    "steps": [
      {
        "key": "intake",
        "label": "Intake",
        "type": "agent",
        "instructionPath": "steps/intake.md",
        "next": "review"
      }
    ]
  },
  "files": {
    "workflow.md": "# Monthly Security Audit\n...",
    "steps/intake.md": "# Intake\n..."
  }
}
```
