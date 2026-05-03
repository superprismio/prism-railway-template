# Task Runner Service

`task-runner` is the first step toward a first-class Tasks workflow.

For the initial slice, it can replace the fixed Railway cron workers by running built-in scheduled tasks:

- Discord sync
- Prism Memory run
- Prism Knowledge source sync
- Prism Knowledge run

It does not yet own prompt-driven automations. Built-in task definitions and run history live in the `site` app DB.

## Endpoints

- `GET /health`
- `GET /tasks`
- `POST /tasks/:key/run`

Manual runs require `X-Task-Runner-Token` when `TASK_RUNNER_TOKEN` is configured.

## Global env

- `PORT=8790`
- `TASK_RUNNER_DISABLED=false`
- `TASK_RUNNER_POLL_SECONDS=60`
- `TASK_RUNNER_TOKEN=<optional internal admin token>`
- `APP_API_BASE_URL=http://site.railway.internal:3100`
- `APP_API_SERVICE_TOKEN=${{site.INTERNAL_SERVICE_TOKEN}}`
- `CODEX_RUNTIME_BASE_URL=http://codex-runtime.railway.internal:3030`

When `APP_API_BASE_URL` is set, the runner idempotently registers built-in task defaults, reads effective enabled state and cron schedules from `site`, and writes task run history through internal APIs.

## Built-in Tasks

The built-in task defaults are seeded into `site` on startup and on scheduler polls only when a row does not already exist:

- `discord-sync`: disabled, `0 * * * *`
- `memory-run`: disabled, `45 * * * *`
- `knowledge-source-sync`: disabled, `15 * * * *`
- `knowledge-run`: disabled, `55 * * * *`

After seeding, `site` DB values are the scheduler source of truth. The runner refreshes task rows on each poll.

## Custom prompt tasks

User-authored scheduled prompt tasks use `taskType=codex-prompt` in the `site` DB. The runner loads these rows from `site`, reads `instructionConfig.prompt`, and replays the prompt through `codex-runtime`.

Supported config:

- `instructionConfig.prompt`: required prompt text
- `instructionConfig.requestedSkills`: optional skill names forwarded to `codex-runtime`
- `inputConfig`: optional metadata passed to the runtime
- `outputConfig`: optional metadata passed to the runtime

The runner calls:

- `POST /v1/responses` on `CODEX_RUNTIME_BASE_URL`

## Workflow runner tasks

Scheduled workflow tasks use `taskType=workflow-runner`. The runner creates a request through `site`, then optionally invokes the current workflow step through `/admin/responses`.

Supported config:

```json
{
  "taskType": "workflow-runner",
  "inputConfig": {
    "workflowKey": "blog-post-draft-review-publish",
    "request": {
      "title": "Weekly blog post",
      "description": "Create this week's blog post from Prism Memory and Knowledge.",
      "requestType": "content",
      "priority": "normal"
    },
    "autoRun": {
      "enabled": true,
      "maxSteps": 1,
      "stopStatuses": ["awaiting-review", "approved", "rejected", "closed"]
    }
  },
  "instructionConfig": {
    "prompt": "Run the current workflow step using the request description and workflow step instructions."
  }
}
```

The default behavior is conservative: auto-run is enabled, but `maxSteps` defaults to `1`, so a scheduled task creates the request and runs only the first agent step unless configured otherwise. The runner stops when the request status reaches one of `stopStatuses`.

The runner calls:

- `POST /api/internal/change-board/requests` on `APP_API_BASE_URL`
- `POST /admin/responses` on `APP_API_BASE_URL`

### Discord sync

- `DISCORD_ADAPTER_BASE_URL=http://discord-adapter.railway.internal:8789`
- `SOURCE_ADAPTER_TOKEN=...`

The runner calls:

- `POST /sync`
- header: `X-Adapter-Token`

### Memory run

- `PRISM_MEMORY_BASE_URL=http://prism-memory.railway.internal:8788`
- `PRISM_API_KEY=...`

The runner calls:

- `POST /ops/memory/run`
- header: `X-Prism-Api-Key`

### Knowledge run

- `PRISM_MEMORY_BASE_URL=http://prism-memory.railway.internal:8788`
- `PRISM_API_KEY=...`

The runner calls:

- `POST /ops/knowledge/run`
- header: `X-Prism-Api-Key`

### Knowledge source sync

- `PRISM_MEMORY_BASE_URL=http://prism-memory.railway.internal:8788`
- `PRISM_API_KEY=...`

The runner calls:

- `POST /ops/knowledge/sources/sync`
- header: `X-Prism-Api-Key`

The Prism Memory endpoint checks each configured GitHub source remote branch head and only syncs sources whose head differs from `last_synced_commit`.

## Validation approach

Deploy this first on the ejected `prism-stack` project from a feature branch.

Recommended rollout:

1. deploy `task-runner` with all tasks disabled
2. use `POST /tasks/:key/run` for manual tests
3. enable one schedule at a time
4. disable the old Railway cron service for that job only after the runner proves stable
