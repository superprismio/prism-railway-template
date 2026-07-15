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
- `GET /agent/tasks/runs`
- `POST /agent/tasks/runs`
- `GET /agent/task-scripts`
- `POST /agent/task-scripts`
- `GET /agent/task-scripts/:key`
- `PATCH /agent/task-scripts/:key`
- `DELETE /agent/task-scripts/:key`
- `GET /agent/task-scripts/:key/content`
- `GET /agent/skills`
- `POST /agent/skills`
- `GET /agent/workflows`
- `POST /agent/workflows`
- `GET /agent/hooks`
- `POST /agent/hooks`
- `GET /agent/runtime-profiles`
- `POST /agent/runtime-profiles`
- `GET /agent/runtime-profiles/:key`
- `PATCH /agent/runtime-profiles/:key`
- `DELETE /agent/runtime-profiles/:key`
- `POST /agent/runtime/invoke`
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
- `POST /agent/change-board/requests/by-number/:requestNumber/workflow/continue`
- `POST /agent/change-board/requests/by-number/:requestNumber/workflow/reconcile`
- `GET /agent/change-board/requests/:id/artifacts/:artifactId/content`
- `GET /agent/site-content/branding`
- `PATCH /agent/site-content/branding`
- `GET /agent/source-adapter-policy`
- `PATCH /agent/source-adapter-policy`
- `GET /agent/gateway`
- `POST /agent/gateway/connections`
- `POST /agent/gateway/integrations`
- `GET /agent/gateway/toolsets`
- `POST /agent/gateway/toolsets`
- `POST /agent/gateway/capabilities`
- `PATCH /agent/gateway/capabilities/:key`
- `POST /agent/gateway/capabilities/:key/test`

For logo, title, brand name, or workspace label changes, use `/agent/site-content/branding`.

For runtime adapter registration, default selection, or routing metadata, use
`/agent/runtime-profiles`. Runtime profiles contain adapter URLs and features,
not provider credentials. The first configured profile becomes the default;
setting `isDefault: true` moves the default to that profile.
Service adapters use `/agent/runtime/invoke` for utility model calls that should
follow the Site-owned default runtime profile.

For source adapter access rules, use `/agent/source-adapter-policy`. Policies are platform-scoped. Use `platforms.discord.targets` for Discord channels or threads, `platforms.discord.groups` for Discord role IDs, and `platforms.discord.users` for Discord user IDs. Use `platforms.telegram.targets` for Telegram chat/group/channel IDs and `platforms.telegram.users` for Telegram user IDs. Telegram DMs are disabled by default unless explicitly enabled in adapter env/config.

For Gateway integration setup and troubleshooting, use the built-in
`prism-gateway-author` skill. Gateway agent routes accept non-secret
configuration only. Never ask for or send credentials through chat or
`/agent/*`; create a pending connection and direct the admin to the returned
Settings credential URL.

Assigned runtime toolsets use short-lived runtime-local tokens. The runtime
interface supports `describe` for the canonical API description and `request`
for flexible same-origin method/path/query/body calls. Provider credentials and
destination origins are never runtime inputs.

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

To approve or continue the current workflow step from Discord, task-runner, or Codex Runtime, use the by-number workflow route. Do not manually patch workflow state.

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/43/workflow/continue" \
  -d '{"comment":"Operator approved this gate from Discord."}'
```

The route records the continue event and uses the normal workflow runner so agent runs and auto-continue behavior stay in sync. Prefer simple `next` flow; do not send `workflowAction` for normal continues.

For a request that is already completed or closed but whose terminal workflow
run (completed or canceled) still projects a non-terminal current step, use the
reconciliation route.
It does not execute workflow steps or repeat side effects. Dry-run first, then
apply the exact repair:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/43/workflow/reconcile" \
  -d '{"dryRun":true}'

curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/43/workflow/reconcile" \
  -d '{"dryRun":false,"comment":"Reconcile verified terminal projection drift."}'
```

If the workflow has more than one terminal step, the dry-run returns candidates
and the apply request must include `terminalStepKey`. Do not use this route for
active requests or as a substitute for continue, cancel, or rerun.

For Prism Memory Discord bucket repair after `discord.category_to_bucket` changes, use Prism Memory ops auth and start with a dry-run:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/memory/repair-discord-buckets" \
  -d '{"from_date":"YYYY-MM-DD","to_date":"YYYY-MM-DD","dry_run":true}'
```

Then rerun with `dry_run:false` and `rebuild:true` if the planned reclassification looks correct.

## Prism Skills

Prism skills are authoritative when a user asks for work covered by a listed skill. Use the skill instructions before probing local paths or browser admin routes.

Do not treat missing local files under `/data/codex/skills`, `/data/workflows`, or `/app` as a blocker for Prism-managed content. In deployed instances, skills and workflows are normally hosted by the site service and reached through `/agent/*`.

Examples:

- Workflow create/update/reasoning: use `prism-workflow-author`, then `GET /agent/workflows` or `POST /agent/workflows`.
- Task create/update/reasoning: use `prism-task-author`, then `GET /agent/tasks` or `POST /agent/tasks`.
- Skill create/update/reasoning: use `prism-skill-author`, then `GET /agent/skills` or `POST /agent/skills`.

Instance-owned deterministic workflows may declare required Gateway toolsets in
`SKILL.md` frontmatter:

```yaml
metadata:
  gateway-toolsets:
    - crm.admin
```

Existing narrow wrappers continue to use `metadata.gateway-capabilities` during
migration. Do not create one narrow capability per route or collection for a
broad OpenAPI/MCP integration.

Do not add Prism-specific Gateway metadata to generic or externally sourced
skills merely to make interactive access work. Admin Console and full-access
source contexts receive enabled organization toolsets from Site policy.

Codex Runtime adds Gateway requirements to the job-scoped session when it
selects the skill. Workflows should reference the skill through
`agentConfig.skills`; tasks should request it through
`instructionConfig.requestedSkills`. Do not duplicate requirement lists in each
workflow, task, or hook. Keep `agentConfig.gatewayCapabilities` only for direct
narrow compatibility calls.

Before removing a legacy integration secret from Codex Runtime, run Prism
Doctor and exercise every enabled workflow, task, and hook that uses the
migrated skill. Keep the old credential available until the Gateway path passes
those instance checks.

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

Inspect the live Discord guild structure before changing Prism Memory bucket mappings:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/guild/channels"
```

Use `mappingCandidates[].id` or `categories[].id` for that instance only. These are Discord category IDs and should be the default keys for `discord.category_to_bucket`. Do not map every child channel ID; child channels inherit through their category. Use channel IDs only for truly uncategorized channel exceptions. Do not reuse IDs from another community.

Send a message:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/messages" \
  -d '{"destinationId":"discord:<channel-id>","content":"Test message"}'
```

For Telegram, use `destinationId:"telegram:<chat-id>"` or send
`{"adapter":"telegram","destinationId":"<chat-id>","content":"..."}`. Telegram
groups/channels appear in `/destinations` after the bot sees an update from that
chat.

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
