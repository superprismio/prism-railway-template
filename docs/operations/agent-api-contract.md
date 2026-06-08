# Agent API Contract

This contract is for Codex Runtime, task-runner, source-adapter, and other machine callers inside a Prism Railway Template instance.

## Route Split

Prism has two API surfaces:

- `/admin/*`: browser/admin UI routes. These require an authenticated admin session.
- `/agent/*`: service-token routes. These are for Codex Runtime and other internal services.

Do not call `/admin/*` with `x-service-token`. If a runtime agent receives `401` from an `/admin/*` route, it should look for the equivalent `/agent/*` route before asking for an admin password.

## Auth

Agents should use:

```bash
PRISM_AGENT_API_BASE_URL
PRISM_AGENT_SERVICE_TOKEN
```

If those names are not present, use the service env names:

```bash
APP_API_BASE_URL
APP_API_SERVICE_TOKEN
```

Send the token as:

```bash
x-service-token: <token>
```

## Common Routes

Tasks:

- `GET /agent/tasks`
- `POST /agent/tasks`
- `DELETE /agent/tasks/:key`
- `GET /agent/tasks/runs`
- `POST /agent/tasks/runs`
- `PATCH /agent/tasks/runs/:id`
- `GET /agent/task-scripts`
- `POST /agent/task-scripts`
- `GET /agent/task-scripts/:key`
- `PATCH /agent/task-scripts/:key`
- `DELETE /agent/task-scripts/:key`
- `GET /agent/task-scripts/:key/content`

Skills:

- `GET /agent/skills`
- `POST /agent/skills`
- `DELETE /agent/skills/:name`
- `GET /agent/skills/:name/download`

Workflows:

- `GET /agent/workflows`
- `POST /agent/workflows`
- `GET /agent/workflows/:key`
- `POST /agent/responses`

Hooks:

- `GET /agent/hooks`
- `POST /agent/hooks`
- `GET /agent/hooks/:key`
- `PATCH /agent/hooks/:key`
- `DELETE /agent/hooks/:key`
- `POST /agent/hooks/:key/trigger`

Requests and artifacts:

- `GET /agent/target-apps`
- `POST /agent/change-board/requests`
- `GET /agent/change-board/requests/:id`
- `PATCH /agent/change-board/requests/:id`
- `GET /agent/change-board/requests/by-number/:requestNumber/review`
- `GET /agent/change-board/requests/by-number/:requestNumber/artifacts`
- `POST /agent/change-board/requests/:id/artifacts`
- `GET /agent/change-board/requests/:id/artifacts/:artifactId/content`
- `POST /agent/source-attachments/ingest`
- `POST /agent/source-attachments/resolve-and-ingest`
- `GET /agent/change-board/requests/:id/external-refs`
- `POST /agent/change-board/requests/:id/external-refs`

Request creation accepts these `requestType` values:

- `bug`
- `feature`
- `issue`
- `content`
- `design`
- `config`
- `ops`

Request creation accepts these `priority` values:

- `low`
- `normal`
- `high`
- `urgent`

If a request creation call sends an invalid type or priority, the `400` response includes `validRequestTypes` or `validPriorities` so agents can retry with a supported value.

Source attachment ingest:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/source-attachments/ingest" \
  -d '{
    "platform": "discord",
    "requestId": "<request-id>",
    "channelId": "<discord-channel-id>",
    "messageId": "<discord-message-id>",
    "attachmentId": "<discord-attachment-id>",
    "lane": "request-artifact",
    "purpose": "workflow-input"
  }'
```

The first slice supports Discord attachments and the `request-artifact`,
`workflow-input`, or `memory-inbox` lanes. The site fetches bytes through the
communication adapter and preserves source provenance. Request/workflow lanes
store a private request artifact. The memory lane writes text-like attachments
to Prism Memory as `session_attachment` records and returns the Memory artifact
URL when available.

When the caller has a Discord message URL rather than explicit ids, use the
resolver route:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/source-attachments/resolve-and-ingest" \
  -d '{
    "messageUrl": "https://discord.com/channels/<guild>/<channel>/<message>",
    "intent": "summarize"
  }'
```

Supported intents:

- `summarize`: writes a text-like attachment to Memory as current-session context.
- `promote-memory`: writes a text-like attachment to Memory and returns the shareable artifact URL.
- `request-artifact`: requires `requestId` and creates a private request artifact.
- `workflow-input`: requires `requestId` and creates a private workflow input artifact.
- `promote-knowledge`: returns a confirmation warning; prefer source-backed Knowledge for long-term canonical docs.

Branding:

- `GET /agent/site-content/branding`
- `PATCH /agent/site-content/branding`

Use the branding routes for logo, platform title, brand name, workspace label, and logo alt text updates.

Source adapter access policy:

- `GET /agent/source-adapter-policy`
- `PATCH /agent/source-adapter-policy`

Use source adapter policy routes for public chat/input access controls. Policies
are platform-scoped. For Discord, `platforms.discord.targets` are channel or
thread IDs, `platforms.discord.groups` are role IDs, and
`platforms.discord.users` are Discord user IDs. The default mode is `readonly`.

Agent sessions:

- `GET /agent/agent-sessions/:sessionId`
- `POST /agent/agent-sessions/:sessionId/messages`
- `GET /agent/agent-sessions/discord/lookup`
- `POST /agent/agent-sessions/discord/upsert`

## Adapter Delivery

The site `/agent/*` API owns Prism content. Transport adapters own destination discovery and message delivery.

For Discord one-off sends from Codex Runtime, use the adapter directly only when the user explicitly asks for immediate delivery:

```bash
COMMUNICATION_ADAPTER_BASE_URL
COMMUNICATION_ADAPTER_TOKEN
```

Resolve destinations:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/destinations"
```

Send a message after resolving the destination id:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/messages" \
  -d '{"destinationId":"<channel-id>","content":"Test message"}'
```

If `COMMUNICATION_ADAPTER_TOKEN` is missing, the adapter returns `401`. Do not use the site service token for adapter `/messages`; it is a different service boundary.

## Content Ownership

The site service owns Prism-managed custom content:

- Custom skills live under the site-managed skills root and are written through `/agent/skills`.
- Custom workflows live under the site-managed workflows root and are written through `/agent/workflows`.
- Workflow outputs that later steps need should be saved as request artifacts through `/agent/change-board/requests/:id/artifacts`.

Codex Runtime may create temporary local files during a run, but durable Prism content should be written through the site API.
