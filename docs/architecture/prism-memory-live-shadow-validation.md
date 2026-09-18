# Live shadow catalog validation — 2026-09-18

The new catalog was built directly from the active Railway Memory service's
processed inbox, not just from the earlier local meeting sample. Production
readers, code deployment, environment configuration, and collector checkpoints
were left unchanged.

## Observed run

- Project: `prism-stack`, production environment, `prism-memory` service.
- Source: `/data/prism_seed/community/inbox/memory/processed`.
- Derived output: `/data/prism_seed/community/shadow/retrieval-v2`.
- First check: September 18, 2026, 17:55:06 UTC.
- Scanned 4,083 JSON files; produced 3,920 logical records and 128 meeting groups.
- No normalization errors. Initial build took 1.278 seconds on Railway.
- Second refresh returned `unchanged` and retained the same generation.
- A read-only retrieval smoke query for `cohort` returned 675 matching passages.
- Published generation:
  `38bff988aedb676941e45705bfb2601e3494c576a244f328c13dd35ac3b00aee`.

The executable modules were staged in a temporary directory for this one-off
validation and removed when the command finished. Only derived catalog files,
locks, and refresh status remain in the shadow directory. No persistent worker
was started. There is no automatic refresh or user-facing cutover yet.

## Implemented locally

The refresh module detects input changes using content hashes, skips unchanged
input, retains the last good generation on failures, and records durable status.
Catalog publication rechecks the inputs to reject changes detected during a build.
An optional service-managed subprocess runs refresh on startup and at a configured
interval; the default is disabled. Ops-only status reports successful publication
and errors. Continuous operation requires deploying this code and enabling the
interval, separately from moving any reader to the new routes.

All 28 Python tests pass, including add/edit/delete refresh, unchanged restart,
invalid-record recovery, missing-source protection, concurrent source-change
rejection, actual API startup/shutdown refresh, and ops-only status authorization.
The prior retrieval and scoping tests also pass. Whitespace validation passes.

## Boundaries still in place

This catalog covers retained processed inbox JSON, not all raw bucket files,
knowledge repositories, or Discord history. Scope enforcement is independent of
whether the files are live. Scoped retrieval requires current source authority
and visibility-policy configuration; none was enabled during this validation.
Upstream deletion/permission synchronization remains pending.

Full rebuilds run only when hashes change. Generations are currently retained;
disk monitoring and reader-safe pruning are required before long-running rollout.
The final hash check bounds observed inconsistency but cannot make independent
filesystem writers transactional. Subsequent refresh passes and scoped original
revision checks handle later changes.
