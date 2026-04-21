# Handoff: Prism Railway Template

Use this document to resume work in a new Codex session.

## Repos

- Template repo: `/home/dekanjbrown/Projects/raidguild/prism-railway-template`
- POC repo/reference: `/home/dekanjbrown/Projects/raidguild/pinata-sites/prism-agent-railway`
- Remote: `git@github.com:raid-guild/prism-railway-template.git`

The template repo was created as a clean clone of the new public GitHub repository. Code was copied from the POC repo with local/runtime artifacts excluded.

## Current Goal

Turn the POC stack into a reusable Railway template:

- manage configuration and required variables before template launch
- provision the service graph through a Railway template
- run post-deploy scripts for API bootstrap, health checks, Discord command setup, and Prism ops checks
- keep manual auth where needed, especially Codex device auth inside `codex-runtime`

## Current Template Repo State

Copied from the POC:

- `services/api`
- `services/site`
- `services/prism-memory`
- `services/source-adapter`
- `services/codex-runtime`
- `services/prism-trigger`
- `packages/contracts`
- deploy/dev/bootstrap scripts
- current architecture and setup docs

Excluded from the template repo:

- `.env`
- `node_modules`
- `dist`
- `.next`
- SQLite DB files
- uploaded avatars/badges
- service `data` directories
- Prism memory runtime volume contents under `services/prism-memory/data`
- Python `.venv`
- `__pycache__`
- local recording files

Added/updated:

- `.env.example`
- `.gitignore`
- `docs/template-authoring.md`
- this handoff doc
- README title and template-authoring link
- `services/api/config/target-apps.default.json` now defaults to empty `targetApps` and `targetEnvironments`
- homepage CTA now links to Railway template docs

Removed from the template repo because they were POC/live-project-specific:

- legacy change-request flow notes
- `docs/railway-migration-plan.md`
- `docs/railway-ops-snapshot-2026-04-17.md`
- `docs/railway-stack-smoke-2026-04-21.md`

## Important POC Learnings

Railway template is the right provisioning boundary. The deploy scripts should not try to create the full project graph from scratch.

Smoke testing a fresh Railway project from the POC found:

- manual CLI service creation works but is cumbersome
- `railway volume ... add --mount-path /data` panicked in Railway CLI 4.11.0 for empty services
- `railway up --project` is not supported by the current Railway CLI
- bootstrap scripts must respect the caller's linked Railway project and print `railway status` before doing remote operations
- `api`, `site`, and `prism-memory` deployed cleanly after linking to a smoke project
- persistent volumes should be configured in the template source project, not via post-deploy scripts

## Intended Railway Template Services

| Service | Source directory | Needs volume | Notes |
| --- | --- | --- | --- |
| `api` | `services/api` | yes, `/data` | SQLite/runtime app state unless moved to external DB later. |
| `site` | `services/site` | no | Admin/public UI. |
| `prism-memory` | `services/prism-memory` | yes, `/data` | File-first memory API and ops. |
| `discord-adapter` | `services/source-adapter` | yes, `/data` | Discord sync, chat, slash commands, voice recording/recovery. |
| `codex-runtime` | `services/codex-runtime` | yes, `/data` | Codex CLI runtime, persisted `CODEX_HOME`, target workspaces. |
| `discord-sync-cron` | `services/prism-trigger` | no | Calls Discord adapter `/sync`. |
| `memory-cron` | `services/prism-trigger` | no | Calls Prism memory `/ops/memory/run`. |
| `knowledge-cron` | `services/prism-trigger` | no | Calls Prism memory `/ops/knowledge/run`. |

## Post-Deploy Manual/Auth Steps

After launching the Railway template:

1. Link local CLI to the new project and environment.
2. Confirm `railway status` points at the new project.
3. Run `scripts/railway-bootstrap-api.sh`.
4. Run health checks for `api`, `site`, `prism-memory`, `discord-adapter`, and `codex-runtime`.
5. SSH into `codex-runtime` and run `codex login --device-auth`.
6. Configure Discord bot token/application/guild vars and verify slash commands.
7. Run Discord sync dry-run, then real sync.
8. Run Prism memory and knowledge cron checks.
9. If change-request target apps are needed, add them through admin/API config after deploy. Do not hardcode POC target IDs in the template.

## Next Session Checklist

1. Continue cleanup in the template repo, not the POC repo, unless explicitly comparing behavior.
2. Run a deeper public-readiness scan for live URLs, IDs, absolute paths, and legacy references.
3. Decide whether to keep historical docs like `docs/codex-first-architecture.md` or replace them with lean template docs.
4. Rename `services/source-adapter` docs/user-facing language to `discord-adapter` where appropriate, while preserving the directory if desired.
5. Confirm Prism memory skills are exposed under Codex/Prism-oriented names before publishing.
6. Add a template-specific `README` quickstart with Railway template source-project setup.
7. Commit and push the initial template repo once cleanup passes.
8. Create a clean Railway source project from this public repo.
9. Configure services, volumes, references, public networking, and cron schedules once in the source project.
10. Generate the Railway template from that source project and smoke-test a fresh deploy.

## Validation Commands

From the template repo:

```bash
bash -n scripts/*.sh
find . -maxdepth 4 \( -name '.env' -o -name 'node_modules' -o -name 'data' -o -name '.venv' -o -name '__pycache__' -o -name 'dist' -o -name '.next' -o -name '*.db' -o -name '*.db-*' -o -name '*.tsbuildinfo' \) -print
rg -n "pinata-sites|Haus Keepers|daohaus|agent-target-staging|up\\.railway\\.app|/home/dekanjbrown" README.md docs services scripts packages .env.example
```

The last command is expected to still find some migration-era references until the public-doc cleanup is complete.
