# Task Runner Service

`task-runner` is the first step toward a first-class Tasks workflow.

For the initial slice, it can replace the fixed Railway cron workers by running built-in scheduled tasks:

- Discord sync
- Prism Memory run
- Prism Knowledge run

It does not yet own prompt-driven automations, task definitions in `site`, or run history in the app DB. Those are later phases.

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

When `APP_API_BASE_URL` is set, the runner registers its built-in tasks and writes task run history into the `site` SQLite DB through internal APIs.

## Built-in task env

### Discord sync

- `TASK_DISCORD_SYNC_ENABLED=false`
- `TASK_DISCORD_SYNC_CRON="0 * * * *"`
- `DISCORD_ADAPTER_BASE_URL=http://discord-adapter.railway.internal:8789`
- `SOURCE_ADAPTER_TOKEN=...`

The runner calls:

- `POST /sync`
- header: `X-Adapter-Token`

### Memory run

- `TASK_MEMORY_RUN_ENABLED=false`
- `TASK_MEMORY_RUN_CRON="45 * * * *"`
- `PRISM_MEMORY_BASE_URL=http://prism-memory.railway.internal:8788`
- `PRISM_API_KEY=...`

The runner calls:

- `POST /ops/memory/run`
- header: `X-Prism-Api-Key`

### Knowledge run

- `TASK_KNOWLEDGE_RUN_ENABLED=false`
- `TASK_KNOWLEDGE_RUN_CRON="55 * * * *"`
- `PRISM_MEMORY_BASE_URL=http://prism-memory.railway.internal:8788`
- `PRISM_API_KEY=...`

The runner calls:

- `POST /ops/knowledge/run`
- header: `X-Prism-Api-Key`

## Validation approach

Deploy this first on the ejected `prism-stack` project from a feature branch.

Recommended rollout:

1. deploy `task-runner` with all tasks disabled
2. use `POST /tasks/:key/run` for manual tests
3. enable one schedule at a time
4. disable the old Railway cron service for that job only after the runner proves stable
