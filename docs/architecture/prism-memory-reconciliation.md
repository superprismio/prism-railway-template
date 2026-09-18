# Memory rewrite reconciliation — 2026-09-18

The rewrite is consolidated on `feat/memory-retrieval-rewrite`.

- `7fab571` preserves the previously uncommitted catalog, refresh, retrieval,
  meeting metadata, evaluation, tests, and optional relationship-pilot work.
- Canonical `origin/main` at `84474c4` is merged into this branch. It includes
  the prior live baseline `b509b33` and subsequent Gateway fixes.
- Older source-history/Buzz copies from the original branch were superseded by
  their current main versions, including Agent Profile policy and runtime
  routing. Duplicate Buzz test additions were removed. Original history remains
  reachable through the checkpoint's parent commits.
- Both service test scripts retain main's checks plus the new memory tests.
- Scoped retrieval now applies current canonical Agent Profile selectors after
  interface credential authorization. Disabled/unresolved bindings deny access;
  empty selectors stay empty and malformed selectors fail closed. Legacy scope
  is used only when there is no canonical binding, matching the migration model
  used by the existing interface authorization route.

Validation: 91 Memory tests, 26 Site pretests and 160 Site tests passed before
profile integration; all six scoped-retrieval tests (including three new
integration cases) then passed. Site and source-adapter typechecks passed;
all 49 source-adapter tests passed. No unresolved conflicts or whitespace errors.

No production configuration, task schedule, source snapshot, or collector state
was changed. The existing uploaded Memory deployment still runs independently;
this branch provides a reproducible Git basis for the next release. Production
retrieval cutover, full-catalog relevance evaluation, passage improvements, and a
scheduled JEV pass remain separate follow-up slices.
