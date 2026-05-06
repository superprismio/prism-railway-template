# Task Runner Handoff

This handoff captures the current state of the `feature/task-runner` branch and the `prism-stack` validation deployment.

## Branch

- Branch: `feature/task-runner`
- Latest commit: `74b7516 Add task runner service`
- PR URL: `https://github.com/raid-guild/prism-railway-template/pull/new/feature/task-runner`

## Goal

Introduce a first-class `task-runner` service that can eventually replace the fixed Railway cron services:

- `discord-sync-cron`
- `memory-cron`
- `knowledge-cron`

This is the first slice of the broader Tasks workflow. It intentionally starts with built-in operational jobs before custom prompt-driven automations.

## Current implementation

### New service

Added:

- `services/task-runner`

Endpoints:

- `GET /health`
- `GET /tasks`
- `POST /tasks/:key/run`

Built-in tasks:

- `discord-sync`
- `memory-run`
- `knowledge-source-sync`
- `knowledge-run`

Runner behavior:

- polls every `TASK_RUNNER_POLL_SECONDS`
- scheduled runs only execute when the task is enabled
- manual runs are allowed even when schedules are disabled
- logs run starts/successes/failures
- writes durable task run history into `site` when `APP_API_BASE_URL` is configured

### Site durable state

Added migration:

- `006_tasks`

Tables:

- `tasks`
- `task_runs`

Internal APIs:

- `GET /api/internal/tasks`
- `POST /api/internal/tasks`
- `GET /api/internal/tasks/runs`
- `POST /api/internal/tasks/runs`
- `GET /api/internal/tasks/runs/[id]`
- `PATCH /api/internal/tasks/runs/[id]`

State ownership:

- `site` owns canonical task definitions and run history in SQLite
- `task-runner` remains restartable and mostly stateless

## Validation status on `prism-stack`

Project:

- Railway project: `prism-stack`
- Project id: `c1fb4fcb-b2ae-425c-ae5b-ffeef40e32af`

Services currently on `feature/task-runner`:

- `site`
- `task-runner`

Services intentionally still on `main`:

- `prism-memory`
- `codex-runtime`
- `discord-adapter`
- existing cron services

### Verified

- `site` deployed from `feature/task-runner`
- migration applied on `site`
- `/api/health` reports `appliedMigrations: 6`
- `task-runner` deployed from `feature/task-runner`
- `task-runner` starts successfully
- all built-in schedules are disabled
- `task-runner` registered built-in tasks into the `site` DB:
  - `discord-sync`
  - `memory-run`
  - `knowledge-run`

### Important note

The first migration attempt saw `totalKnown: 5` because it hit the previous running `site` container while the branch deployment was still building.

After `site` finished deploying from `feature/task-runner`, rerunning:

```bash
railway ssh --service site -- sh -lc 'cd /app && npm run migrate'
```

applied:

```json
{
  "ok": true,
  "executed": ["006_tasks"],
  "totalKnown": 6
}
```

## Required env

### `site`

No new task-specific env is required.

It must keep the existing app DB settings:

```env
SITE_USE_LOCAL_APP_API=true
PRISM_AGENT_DATA_ROOT=/data
INTERNAL_SERVICE_TOKEN=...
```

### `task-runner`

Current validation env:

```env
PORT=8790
TASK_RUNNER_DISABLED=false
TASK_RUNNER_POLL_SECONDS=60
TASK_RUNNER_TOKEN=${{site.INTERNAL_SERVICE_TOKEN}}

APP_API_BASE_URL=http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}
APP_API_SERVICE_TOKEN=${{site.INTERNAL_SERVICE_TOKEN}}

DISCORD_ADAPTER_BASE_URL=http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}
SOURCE_ADAPTER_TOKEN=${{discord-adapter.SOURCE_ADAPTER_TOKEN}}

PRISM_MEMORY_BASE_URL=http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}:${{prism-memory.PORT}}
PRISM_API_KEY=${{prism-memory.PRISM_API_KEY}}
```

Do not enable schedules yet. Built-in task defaults are now code-backed and are seeded into `site` only when a task row does not already exist. After startup, `site` DB owns enabled state and schedules.

## Next validation steps

Wait for `task-runner` to redeploy latest commit:

- `74b7516`

Then test manual runs.

### Check health

From inside Railway:

```bash
railway ssh --service task-runner -- sh -lc \
  'node -e "fetch(\"http://127.0.0.1:\"+(process.env.PORT||8790)+\"/health\").then(r=>r.text()).then(console.log)"'
```

Expected:

- service ok
- three built-in tasks listed
- schedules disabled

### Check registered tasks from `site`

```bash
TOKEN=$(railway variables --service site --json | node -e \
  "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).INTERNAL_SERVICE_TOKEN||''))")

curl -fsS \
  -H "X-Service-Token: $TOKEN" \
  https://site-production-fef4.up.railway.app/api/internal/tasks
```

Expected:

- `discord-sync`
- `memory-run`
- `knowledge-run`

### Manual run tests

Because `task-runner` has no public domain on `prism-stack`, run from inside the container:

```bash
railway ssh --service task-runner -- sh -lc \
  'node -e "
    const token=process.env.TASK_RUNNER_TOKEN;
    fetch(\"http://127.0.0.1:\"+(process.env.PORT||8790)+\"/tasks/memory-run/run\", {
      method:\"POST\",
      headers:{\"X-Task-Runner-Token\":token}
    }).then(async r=>{ console.log(r.status); console.log(await r.text()) })
  "'
```

Then repeat for:

- `/tasks/knowledge-run/run`
- `/tasks/discord-sync/run`

After each run, check run history:

```bash
curl -fsS \
  -H "X-Service-Token: $TOKEN" \
  "https://site-production-fef4.up.railway.app/api/internal/tasks/runs?limit=20"
```

## Rollout approach

Do not disable the old Railway cron services yet.

Recommended sequence:

1. Validate all three manual runs.
2. Enable only `memory-run` schedule.
3. Disable old `memory-cron`.
4. Watch one scheduled run.
5. Repeat for `knowledge-run`.
6. Repeat for `discord-sync`.

## Known follow-up

The runner now treats `site` DB as the source of truth for built-in enabled state and schedules. Remaining follow-up is to add a UI/API workflow for operators to edit task rows without using internal API calls.

## Verification already run

Local verification:

```bash
PRISM_AGENT_DATA_ROOT=/tmp/prism-site-task-test npm run migrate --workspace @prism-railway/site
npm run build --workspace @prism-railway/site
npm run build --workspace @prism-railway/task-runner
```

All passed.
