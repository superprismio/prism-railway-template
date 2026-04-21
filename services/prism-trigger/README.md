# Prism Trigger Service

Generic one-shot trigger worker for Railway cron jobs.

Deploy this same directory twice:

- `memory-cron`
- `knowledge-cron`

Example envs:

For `memory-cron`:

- `PRISM_API_BASE=https://your-prism-memory.up.railway.app`
- `PRISM_TRIGGER_PATH=/ops/memory/run`
- `PRISM_API_KEY=...`

For `knowledge-cron`:

- `PRISM_API_BASE=https://your-prism-memory.up.railway.app`
- `PRISM_TRIGGER_PATH=/ops/knowledge/run`
- `PRISM_API_KEY=...`

For `discord-sync-cron` hitting the source adapter:

- `PRISM_API_BASE=https://your-discord-adapter.up.railway.app`
- `PRISM_TRIGGER_PATH=/sync`
- `PRISM_TRIGGER_AUTH_HEADER=X-Adapter-Token`
- `PRISM_TRIGGER_AUTH_TOKEN=...`

Optional trigger envs:

- `PRISM_TRIGGER_BODY={"dryRun":false}`
- `PRISM_TRIGGER_PATH=/sync?dry_run=true`
- `PRISM_TRIGGER_RETRY_ATTEMPTS=6`
- `PRISM_TRIGGER_RETRY_DELAY_SECONDS=5`
