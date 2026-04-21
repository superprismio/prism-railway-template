# Prism Railway Template Deploy Runbook

Use this after deploying the Railway template into a fresh project.

## 1. Link The CLI

From a checkout of `raid-guild/prism-railway-template`:

```bash
railway link --project <project-id> --environment production
railway status
```

Confirm the project and environment match the new deploy before running any remote commands.

## 2. Expected Services

The deployed project should include:

| Service | Root directory | Volume |
| --- | --- | --- |
| `api` | `/services/api` | `/data` |
| `site` | `/services/site` | none |
| `prism-memory` | `/services/prism-memory` | `/data` |
| `discord-adapter` | `/services/source-adapter` | `/data` |
| `codex-runtime` | `/services/codex-runtime` | `/data` |
| `discord-sync-cron` | `/services/prism-trigger` | none |
| `memory-cron` | `/services/prism-trigger` | none |
| `knowledge-cron` | `/services/prism-trigger` | none |

## 3. Smoke Checks

Get service domains from Railway, then check:

```bash
curl https://<api-domain>/api/health
curl https://<site-domain>/
curl https://<prism-memory-domain>/health
curl https://<discord-adapter-domain>/health
curl https://<codex-runtime-domain>/health
```

Expected early results:

- `api` returns `ok: true` and shows applied migrations.
- `site` returns HTML.
- `prism-memory` returns `ok: true` and `space: community`.
- `discord-adapter` returns `ok: true`; Discord may show `discordReady: false` until Discord credentials are set.
- `codex-runtime` returns `ok: true`.
- `memory-cron` and `knowledge-cron` should stop after successful one-shot runs.
- `discord-sync-cron` should stop cleanly with `PRISM_TRIGGER_DISABLED=true`.

## 4. Bootstrap The API

```bash
bash scripts/railway-bootstrap-api.sh --environment production --service api
```

Expected:

- migrations are applied or already current
- admin bootstrap succeeds
- target bootstrap succeeds with zero default target records unless you added a manifest

Do not share terminal output from this command publicly; Railway prints service environment variables.

## 5. Codex Device Auth

SSH into the Codex runtime:

```bash
railway ssh -s codex-runtime
```

Inside the Railway shell:

```bash
mkdir -p /data/codex
export CODEX_HOME=/data/codex
export PATH="/app/node_modules/.bin:$PATH"
codex login --device-auth
```

Complete the browser device-auth flow, then exit:

```bash
exit
```

The auth files live under `/data/codex` on the mounted volume and should persist across redeploys.

## 6. Discord Setup

Set these on `discord-adapter` when ready to enable Discord:

```text
DISCORD_BOT_TOKEN=<bot-token>
DISCORD_GUILD_ID=<guild-id>
DISCORD_APPLICATION_ID=<optional-application-id>
```

`DISCORD_APPLICATION_ID` is optional but recommended for slash command registration.

After setting Discord credentials, redeploy `discord-adapter` and check:

```bash
curl https://<discord-adapter-domain>/health
```

Expected:

```json
"discordReady": true
```

## 7. Enable Discord Sync Cron

`discord-sync-cron` deploys disabled by default:

```text
PRISM_TRIGGER_DISABLED=true
```

After Discord credentials are working, set:

```text
PRISM_TRIGGER_DISABLED=false
```

or remove the variable, then add a Railway cron schedule for `discord-sync-cron`.

The service should keep:

```text
PRISM_API_BASE=https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}
PRISM_TRIGGER_PATH=/sync
PRISM_TRIGGER_AUTH_HEADER=X-Adapter-Token
PRISM_TRIGGER_AUTH_TOKEN=${{discord-adapter.SOURCE_ADAPTER_TOKEN}}
PRISM_TRIGGER_BODY={}
```

Before enabling a recurring schedule, run one dry sync manually if desired:

```bash
TOKEN="$(railway variable list -s discord-adapter --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).SOURCE_ADAPTER_TOKEN || ''))")"
curl -X POST "https://<discord-adapter-domain>/sync?dry_run=true" \
  -H "X-Adapter-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}"
```

## 8. Optional Voice Transcription

Set on `discord-adapter`:

```text
VENICE_API_KEY=<venice-key>
```

Then test `/prism-record` and `/prism-stoprecord` in Discord.

## 9. Optional Target Repo Access

Set on `codex-runtime` only if Codex should clone or push private target repositories:

```text
TARGET_REPO_GITHUB_TOKEN=<github-token>
```

Public target repositories may not need this.

## 10. Final Template Notes

Template-generated secrets should use Railway template functions:

```text
${{ secret(32) }}
${{ secret(64) }}
```

Do not hardcode source-project or smoke-project secret values into published template variables.
