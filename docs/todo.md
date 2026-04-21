# TODO

Current open items for turning the POC into a clean Railway template.

## Template Readiness

- [ ] Replace remaining migration-era docs with lean public template docs.
- [ ] Decide whether to keep `docs/codex-first-architecture.md` as history or rewrite it as the public architecture overview.
- [ ] Rename public-facing `source-adapter` language to `discord-adapter` where appropriate.
- [x] Move Prism memory skills to Codex/Prism-oriented paths.
- [x] Remove legacy route/function names from API code where they are no longer used.
- [ ] Add a template-specific quickstart that starts from Railway template deployment, not POC migration.
- [ ] Add a source-project checklist for configuring root dirs, volumes, health checks, public networking, reference variables, and cron schedules.
- [ ] Add post-deploy smoke scripts for `api`, `site`, `prism-memory`, `discord-adapter`, and `codex-runtime`.
- [ ] Add a safe target-app bootstrap path that does not hardcode live project IDs or organization-specific repos.

## Railway Template Source Project

- [ ] Create a clean Railway source project for this template.
- [ ] Add services for `api`, `site`, `prism-memory`, `discord-adapter`, `codex-runtime`, `discord-sync-cron`, `memory-cron`, and `knowledge-cron`.
- [ ] Attach `/data` volumes to `api`, `prism-memory`, `discord-adapter`, and `codex-runtime`.
- [ ] Configure required variables and generated secrets using Railway template variables where possible.
- [ ] Configure service reference variables so internal URLs and tokens are not copied manually.
- [ ] Configure cron schedules in Railway for Discord sync, memory, and knowledge jobs.
- [ ] Generate the Railway template from the source project.
- [ ] Deploy the generated template into a fresh project and verify the full bring-up path.

## Post-Deploy Operations

- [ ] Document Codex device auth inside `codex-runtime`.
- [ ] Document Discord bot creation, invite scopes, and slash command registration.
- [ ] Document optional Venice transcription setup.
- [ ] Document optional GitHub token setup for target app CR branches.
- [ ] Document target app configuration through the admin/API layer.
- [ ] Document backup/recovery expectations for mounted volumes.

## Product Follow-Up

- [ ] Keep the admin board flow aligned with GitHub branch/PR review.
- [ ] Add GitHub issue import as a future CR intake source.
- [ ] Add PR review/comment sync back into CR state.
- [ ] Keep execution telemetry lightweight in the board and link to GitHub/Railway for detailed artifacts.
