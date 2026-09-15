# PR #86 authorization review

## Local fixes (September 15, 2026)

- Both source credential-list routes apply the same profile credential filter
  as Console dispatch. `none` returns no keys; `allowlist` intersects enabled
  credentials; genuinely unbound legacy full-access sources retain their behavior.
- An enabled binding to an inactive profile denies access rather than falling
  back to a parent or legacy policy.
- Runtime skill discovery no longer expands the Site-authorized credential
  lease. Buzz CLI children no longer inherit the adapter's service credentials.
- Local Codex registration advertises repository, shell, and browser capabilities.
- A full-migration regression test confirms that migration 052 assigns seeded
  maintenance to Dreamer. Migration 051 intentionally retains its historical
  Admin seed; the review's assertion about that seed test was incorrect.
- Deployment documentation now reflects the intentional default-on Lab cutover.

## Unresolved: restricted-source runtime authority

Review: https://github.com/superprismio/prism-railway-template/pull/86#discussion_r4019787965

The fixes above are not an end-to-end authorization boundary. Source access modes
and allowed workflows are passed as policy instructions. `/agent/runtime/invoke`
accepts shared service authentication, and full runtime children inherit service
credentials. Site mutations authenticate that same shared token.

Checking a request body's `sourceSessionId` is insufficient: a tool-using runtime
with the shared token can omit or substitute it, call another mutation route, or
invoke a new runtime job. Likewise, filtering Gateway key lists does not remove
legacy secrets already present in the runtime environment.

Do not mark this finding resolved or treat `readonly` / `run-approved` as enforced
security boundaries on this execution path yet. Do not silently convert these
profiles to text-only utility mode: that would remove their intended reads and
approved workflow actions.

### Required implementation boundary

1. Authenticate adapters separately from model-facing jobs. Resolve the live
   source identity, binding, overrides and profile policy on Site before dispatch.
2. Issue short-lived job-scoped credentials bound to that resolved identity;
   never give restricted jobs the shared service token or credential-lease token.
3. Enforce scoped permissions centrally on agent API requests, with default denial
   for unclassified routes. Enforce allowed workflows on creation and execution,
   not only on request metadata. Bind resource access to the job's actual scope.
4. Prevent scope escalation through runtime invocation, session mutation, profile
   updates, Gateway operations, alternate auth aliases, or stale continuations.
5. Isolate restricted execution from host secrets, other jobs, shared homes and
   credentials on disk. An environment-variable filter alone is not isolation.
   Keep this contract provider-neutral and reject unsupported runtime capability.
6. Preserve trusted Admin/full-source behavior explicitly and test it alongside
   restricted profiles; do not revoke working integrations as an incidental fix.

### Required regression checks

- Readonly rejects mutations even with missing or forged source/session metadata.
- Run-approved accepts only its configured workflows and cannot author workflows.
- Expired, revoked, disabled-profile and cross-session credentials are rejected.
- A restricted child cannot obtain shared tokens through environment, files,
  continuation reuse, credential leasing, or nested runtime calls.
- Admin and intended full-access workflows retain their authorized integrations.

This work is a cross-service authorization change, not a prompt-only patch.
