# Railway Setup

## Recommended Services

Create these Railway services from this repo:

1. `site` from `/services/site`
2. `prism-memory` from `/services/prism-memory`
3. `discord-adapter` from `/services/source-adapter`
4. `codex-runtime` from `/services/codex-runtime`
5. `discord-sync-cron` from `/services/prism-trigger`
6. `memory-cron` from `/services/prism-trigger`
7. `knowledge-cron` from `/services/prism-trigger`

## Recommended Provisioning Path

Use a Railway template for first-time project creation if possible. A template is a better fit than a shell script for the full project shape because it can capture service names, root directories, variables, domains, and volume mounts in one repeatable install flow.

The current shell scripts are best treated as post-provisioning helpers:

- deploy existing services from a checkout already linked to the intended Railway project
- bootstrap the API database
- run smoke checks or Prism ops jobs

Do not rely on `scripts/railway-deploy-prism-stack.sh --project ...` with Railway CLI 4.x. `railway up` does not accept a project flag. Link the checkout first:

```bash
railway link --project <railway-project-id> --environment production
railway status
```

Then run deploy/bootstrap helpers without `--project`.

## Root Directories

Set each Railway service root directory to the matching service folder.

## Watch Paths

Suggested watch paths:

- `site`: `/services/site/**` and `/packages/**`
- `prism-memory`: `/services/prism-memory/**`
- `discord-adapter`: `/services/source-adapter/**`
- `codex-runtime`: `/services/codex-runtime/**`
- `discord-sync-cron`: `/services/prism-trigger/**`
- `memory-cron`: `/services/prism-trigger/**`
- `knowledge-cron`: `/services/prism-trigger/**`

## Stack Bring-Up Checklist

1. Deploy `site` and confirm `/api/health`.
2. Run `npm run migrate --workspace @prism-railway/site`.
3. Run `npm run bootstrap:admin --workspace @prism-railway/site`.
4. Run `npm run bootstrap:targets --workspace @prism-railway/site`.
7. Deploy `prism-memory` with a persistent volume and `PRISM_API_KEY`.
8. Deploy `codex-runtime` from `services/codex-runtime`, attach a persistent volume, set `CODEX_HOME=/data/codex`, and complete `codex login` once inside the running service.
9. Deploy `discord-adapter` from `services/source-adapter` with `SOURCE_KIND=discord`, `PRISM_API_BASE`, `PRISM_API_KEY`, Discord credentials, `APP_API_BASE_URL`, `INTERNAL_SERVICE_TOKEN`, and `CODEX_RUNTIME_BASE_URL`.
10. Deploy `discord-sync-cron` with `PRISM_API_BASE=https://your-discord-adapter.up.railway.app`, `PRISM_TRIGGER_PATH=/sync`, `PRISM_TRIGGER_AUTH_HEADER=X-Adapter-Token`, and `PRISM_TRIGGER_AUTH_TOKEN=<SOURCE_ADAPTER_TOKEN>`.
11. Deploy `memory-cron` and `knowledge-cron` with `PRISM_API_BASE` and `PRISM_API_KEY`.

Codex login/bootstrap reference:

- [Codex Runtime Device Auth](codex-runtime-auth.md)

## CLI Shortcuts

Bootstrap the deployed site service from your local terminal:

```bash
npm run railway:bootstrap-site -- \
  --environment production \
  --service site
```

The bootstrap helper prints `railway status` before running remote commands. Confirm the project is correct before continuing.

Deploy `prism-memory` and optionally trigger processing:

```bash
npm run railway:deploy-prism-stack -- \
  --prism-api-base https://prism-memory-production.up.railway.app \
  --prism-api-key <PRISM_API_KEY> \
  --run-memory \
  --run-knowledge
```

This wrapper now also deploys `site`, runs `migrate`, `bootstrap:admin`, and `bootstrap:targets` on `site`, and deploys `prism-memory`.

These wrappers do not replace:

- initial Railway project/service/volume provisioning
- Codex login/bootstrap
- Discord adapter onboarding
- Railway secret entry
- Railway cron schedule setup

See archived Railway smoke-test notes for the latest fresh-project findings and template recommendation.

## Shared Env Links

Expected internal/public URLs:

- `site -> site`: `NEXT_PUBLIC_API_BASE_URL`, `API_INTERNAL_BASE_URL`
- `api -> prism-memory`: `PRISM_API_BASE_URL`
- `source-adapter -> prism-memory`: `PRISM_API_BASE`, `PRISM_API_KEY`, `PRISM_INGEST_PATH`
- `discord-sync-cron -> source-adapter`: `PRISM_API_BASE`, `PRISM_TRIGGER_PATH`, `PRISM_TRIGGER_AUTH_HEADER`, `PRISM_TRIGGER_AUTH_TOKEN`
- `cron -> prism-memory`: `PRISM_API_BASE`, `PRISM_API_KEY`

## Deliberate Differences From The Pinata Repo

- no PM2
- no path-prefix routing requirement
- no single container supervising five processes
- no assumption that Discord intake and Prism workers live beside the site
- Codex is the primary operator runtime
- source ingestion is modeled as adapters posting normalized batches into `prism-memory`, not as `prism-memory` polling one hardcoded Discord endpoint
