# Prism Lab completion and cleanup handoff

Updated: 2026-09-16. This is a handoff, not an authorization to delete production data.

## Objective

Finish the Lab transition by auditing and removing obsolete Site UI/code/assets,
and correcting stale documentation. The operator suspects substantial leftover
Site artifacts. Their obsolescence has **not** yet been established. Start by
distinguishing repository leftovers from durable request artifacts on the Site
volume; do not treat the latter as disposable build output.

## Working state

- Canonical repository: `superprismio/prism-railway-template`.
- At the latest fetch, main was `a1ca989`, merging diagnostics PR #87 after
  Gateway repair `b9b59ef` and Lab merge PR #86 (`1d00a2b`).
- Railway prism-stack services were switched to canonical main and deployed.
- Diagnostics code `ed85813` from `codex/run-failure-diagnostics` is now merged
  through PR #87. Deployment of that merge has not been verified in this handoff.
- Use worktree `/home/dekanjbrown/Projects/raidguild/prism-gateway-restart-hotfix`
  for this work. Despite its directory name, its current branch is
  `codex/lab-cleanup-handoff`, based on main after PR #87.
- The original checkout at `/home/dekanjbrown/Projects/raidguild/prism-railway-template`
  remains on old `feat/discord-historical-search-spec`. Do not use that old tree
  as a cleanup baseline or merge it wholesale: Lab and Discord history already
  reached main through the Lab branch. Fetch and establish current main first.
- Other worktrees may belong to separate work. Do not sweep their changes in.

## What already works / must remain true

- Lab is default-on without a required environment variable. Only explicit
  `PRISM_LAB_ENABLED=false` opts out; `PRISM_LAB_DEFAULT` is retired.
- Bare authenticated `/admin` goes to Lab. Query-bearing legacy settings links
  and `/admin?legacy=true` still serve intentional compatibility purposes.
- Discord historical search is merged. Do not implement it again.
- Gateway restart repair preserves configured credential mappings; it is on main.
  Do not introduce new credential restrictions as part of UI cleanup.
- Operational/CMS requests must not silently become code-change requests.
- Instance-owned workflows, profiles, skills, domains and schedules are live
  configuration, not necessarily replicas of bundled defaults.

## First cleanup batch

1. Inventory `services/site/src/app`, components, libraries, `public`, docs and
   bundled skills/workflows. Classify each proposed removal as unused, replaced,
   compatibility-required, shared, or unresolved; record references and callers.
2. Trace legacy entry rendering and settings dependencies before removing old
   board/console code. Lab still links to legacy configuration forms. Admin API
   routes are not obsolete merely because their names contain `admin`.
3. Audit duplicate screenshots/static assets and generated files. Check tracked
   status and actual consumers; a generated `tsconfig.tsbuildinfo` on disk does
   not by itself require a repository change.
4. Update `docs/operations/prism-lab-cutover-checklist.md`: it retains historical
   opt-in/two-flag/pre-merge language and unchecked rollout items alongside a newer
   default-on decision. Separate historical evidence from current requirements;
   do not mark unverified acceptance checks complete.
5. Reconcile `docs/operations/prism-lab-routing.md` with current behavior. Preserve
   credential deep links, form feedback and settings access until replacements
   have been verified. Prefer a small compatibility redirect to duplicated UI
   when capability parity exists.
6. Make small removal batches on a fresh main-based branch, with a removal
   manifest and tests. No database/volume cleanup is implied by this work.

## Validation and completion criteria

- No remaining imports or runtime/dynamic callers for deleted modules/assets.
- Site tests, routing tests, typecheck and production build pass.
- Browser checks cover login, bare admin entry, Lab inbox/detail/chat, artifacts,
  retry/cancel, agent management, settings and mobile navigation.
- Credential setup links and legacy form errors/return navigation still work.
- Check actual member/moderator behavior where an authorized test session exists;
  prior field testing was mostly admin, not proof of lower-role parity.
- Document retained legacy surfaces with a reason and next migration step.
- Keep request history, receipts, migrations and instance configuration intact.
- Report what was deleted, what remains, and which acceptance tests are unverified.

## Merged diagnostics

`ed85813` preserves actual Gateway lease error codes; saves bounded/redacted
script failure details; and surfaces failure/recovery text in Lab request UI.
Validation: 30 task-runner tests, 37 runtime tests, 2 Site diagnostics tests and
Site typecheck passed. PR #87 is merged; verify deployed behavior separately.

## Live RAID agent follow-up (separate from cleanup)

- Request #2656, UUID `f53bad5e-bda1-4aee-a119-618aa2a78abb`, workflow
  `raid-project-portal-sync`, executor `raid-project-sync-steward`.
- Initial setup succeeded, but worker guessed nonexistent Site discovery routes.
  Live workflow instructions now name the existing adapter `GET /guild/channels`
  with `X-Adapter-Token`, using the runtime's existing adapter environment.
- First retry discovered RAIDS channels and created member-only Portal Projects
  174 (Raideuro/EVRO) and 175 (For Goodness Stake). It then reported Discord 403
  for the two Livepeer channels; report saved as `raid-project-sync-report.json`.
- Operator corrected permissions. Direct PrismBOT message reads for
  `1537546730265116672` and `1545077786870288465` returned HTTP 200.
- Operator requested another retry; Site accepted run
  `271c90c7-7ca0-42ef-a2e5-2d26bbd0f50b` as queued. Its final result has NOT been
  checked. User subsequently asked why it still showed blocked, then requested
  this handoff. Inspect latest run and attention timestamps before diagnosing
  stale UI or issuing another retry. Do not duplicate existing Projects.
- Daily task `daily-raid-project-portal-sync` was disabled pending initial sync
  validation. Check live state rather than assuming it is now enabled.
- Read through `/agent/change-board/requests/by-number/2656/review` and
  `/agent/change-board/requests/by-number/2656/artifacts` using service auth.
  Never print tokens or use service auth against `/admin/*`.

## Suggested next-task prompt

Read this handoff and audit the remaining Site artifacts from the Lab transition.
Start from current canonical main, including the merged diagnostics changes,
and produce an evidence-backed keep/remove inventory. Implement the clearly
unused repository cleanup in small tested batches, preserve working settings
and compatibility routes, and correct outdated cutover documentation. Do not
delete production artifacts or expand authorization policy. Also read the
latest #2656 result and explain its remaining blocked state without replaying
completed side effects.
