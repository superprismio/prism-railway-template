# Prism Lab cutover readiness

Audit: 2026-09-15. Scope: promote the field-tested Lab experience, not retire all
legacy functionality or implement the entire orchestration roadmap.

## Decision

Proceed with release preparation; do not flip the default route yet. Existing
field operations work, but routing compatibility, configuration preservation,
and deployed acceptance checks remain release gates. No live writes, rollout,
or database restoration were performed during this audit.

## Evidence collected

- Worktree: `prism-railway-template-lab`, branch `feat/prism-lab-first-slice`.
- Before this audit commit, HEAD and its fetched remote branch matched at
  `ef9a72d`. Compared with fetched `origin/main`, Lab has 54 unique commits and
  main has one: `e88994f` (merge of Playwright PR #84). Reconcile this explicitly;
  do not reset or overwrite either branch.
- Site baseline: 25 pretests and 156 standard tests passed.
- Runtime baseline: build and 35 tests passed, including browser tooling and
  normalized job completion/cancellation contracts.
- Earlier focused routing tests and Site typecheck passed; rerun on the exact
  release commit after integration. Unit/contract tests do not replace browser
  acceptance or restart testing.
- Live readback: App Builder workflow v9, maintenance v7, Veydrift autopilot v40.
- Live maintenance launcher: daily 08:00 America/Denver; two legacy schedules
  disabled. Doctor's separate built-in schedule remains disabled.
- Live #2440 completed/closed; #2541 and #2604 canceled/closed. Do not replay
  these requests as cutover tests.
- `/admin` still renders the legacy ChangeBoard. Lab remains explicitly opt-in
  via `PRISM_LAB_ENABLED=true`.
- Lab Settings still links to `/admin?tab=settings&settings=...`. Branding,
  members, targets, environments, capture dispatch and diagnostics remain
  legacy surfaces. A blanket `/admin` redirect would break access.

## Required before promotion

Preparation update: merged `origin/main` (`e88994f`) into the Lab branch without
conflicts. Implemented reversible bare-entry routing, explicit legacy escape,
return navigation, and settings-link cleanup; see [routing inventory](prism-lab-routing.md).
Live rollout flags remain unchanged. Deployed acceptance is still required.

- [x] Integrate the missing main commit; review the aggregate release diff and
  commit all intended browser, maintenance and request-routing changes.
- [x] Implement reversible default routing: bare authenticated `/admin` redirects
  to Lab only with both `PRISM_LAB_ENABLED=true` and `PRISM_LAB_DEFAULT=true`.
  Explicit query URLs remain legacy, including credential links and errors;
  `/admin?legacy=true` is the escape hatch. Lab request links are unchanged.
  Production flag activation and browser/auth acceptance remain pending.
- [ ] Verify capability parity for admin, operator and request-viewer accounts:
  inbox, chat, artifacts, approval/retry/cancel, agent management and settings.
- [ ] Confirm all service callers explicitly select workflows. The new agent
  API and shared creation function reject missing workflow keys. External custom
  callers may need updates; never substitute code work merely to satisfy validation.
- [ ] Resolve Doctor's catalog precedence defect: runtime skill entries currently
  overwrite Site-hosted entries by name in `doctorMergeSkills`. Test canonical
  Site precedence while retaining runtime-only skills. Do not hide findings.
- [ ] Reconcile bundled vs Site-owned instructions. Local maintenance changes do
  not include all live v7 quiet-reporting rules; deploying repository markdown
  is not proof that a custom instance workflow has been updated. The live custom
  change-request workflow must receive the operational-lane triage safeguard
  through a reviewed update if it does not load the bundled file.
- [ ] Export non-secret workflow/task/profile/domain/binding/skill configuration
  and record versions/hashes before deployment. Back up Site database and volumes
  securely, including Gateway encrypted state and restoration dependencies; never
  place secrets or database dumps in Git or request artifacts.
- [ ] Record current successful Railway deployment IDs and service revisions.
  Drain active work or verify durable job restart behavior before changing runtime
  services. Do not blindly retry runs that may have external side effects.
- [ ] Run Site production build, Site tests/typecheck/routing/maintenance tests,
  runtime tests, and affected task-runner tests on the integrated release candidate.

## Configuration ownership

| Change | Release treatment |
| --- | --- |
| Explicit workflow selection and CMS-vs-code guidance | Template code/skill fix; validate custom callers and live custom triage instructions |
| Runtime browser discovery | Generic runtime feature; test launch in deployed job environment |
| Maintenance bounded completion/report semantics | Generic contract with instance-owned schedule/destination; retain quiet no-op policy |
| App Builder combined-candidate recovery v9 | Preserve custom workflow; do not overwrite during template bootstrap |
| Veydrift policy v40 and Solar Satellite prohibition | Instance-owned gameplay authorization; never template defaults |
| Brand Discord full-access binding / shared GitHub dependency | Instance-owned access/configuration; preserve explicitly, test a read only |
| Steward domains, owners, model presets | Preserve instance assignments and historical snapshots; audit unresolved fallbacks |

## Deployed acceptance checklist

Use isolated test records and read-only checks wherever possible. Any test with
an external write needs a designated target and cleanup plan.

- [ ] Login, bare entry routing, old bookmarks, settings links, mobile layout and
  one-click legacy escape all work without redirect loops.
- [ ] Chat retains history/timestamps, receives updated source binding policy,
  and cancellation releases the UI without late completion corrupting state.
- [ ] Missing workflow selection returns actionable 400 with no request or run;
  an explicit operational workflow still starts correctly.
- [ ] CMS/module operations do not create GitHub issues or repository changes.
- [ ] Request approval, retry, checkpoint receipt, artifact reads/uploads and
  inbox state agree with canonical run history.
- [ ] Independent verification/review uses the same pinned candidate; changed
  shared source takes the bounded recovery loop without deleting existing apps.
- [ ] Browser verification launches with isolated job HOME; unsupported adapters
  report capability limitations rather than claiming checks passed.
- [ ] Restart/cancel/expired lease scenarios produce accurate recoverable state
  and no duplicate publication, deployment, message or transaction.
- [ ] Brand Action Items lookup succeeds from a fresh Discord turn; approval
  rules for writes remain unchanged. Do not claim access from catalog presence.
- [ ] Daily Dreamer sweep saves its report and sends no Discord message for a
  clean/unchanged result; new actionable findings retain accepted delivery receipts.

## Cutover and rollback

1. Freeze the release revision and configuration manifest; capture backups.
2. Deploy with Lab still opt-in; run acceptance checks and record evidence.
3. Enable default routing on prism-stack only; preserve legacy access and observe
   at least one daily maintenance cycle plus representative request workflows.
4. On navigation/access regressions, disable default routing first. Keep API
   routes, data and historical requests intact. Roll back service images only
   after checking schema compatibility and active job reconciliation.
5. Do not restore an old database merely to undo a UI promotion: that would lose
   work performed since cutover. Database restoration is disaster recovery, not
   the ordinary rollback path.
6. Retire legacy components only after usage/parity evidence; not in initial cutover.

Deferred: full legacy-settings redesign, advanced orchestration, new domains or
RBAC, broad performance/model tuning, and unrelated operational backlog. A blocked
business request is not itself a UI release blocker; state corruption, unsafe
retries, broken authorization or inaccessible recovery controls are.

Next implementation batch: routing compatibility + Doctor precedence correction
+ configuration reconciliation, then production build and deployed acceptance.
