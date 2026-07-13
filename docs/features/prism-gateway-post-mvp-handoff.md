# Prism Gateway Post-MVP Handoff

Status: active future-work handoff

MVP completion: [Prism Gateway MVP Implementation Plan](./prism-gateway-mvp-implementation-plan.md)

Operations: [Prism Gateway Migration](../operations/prism-gateway-migration.md)

## Completed Boundary

The MVP establishes Gateway as the durable owner of organization integration
credentials. Site owns profile assignment and admin UX. Downstream services
continue to own API semantics and RBAC. Codex Runtime is a consumer rather than
the credential registry.

Production-proven access modes:

- fixed-origin authenticated HTTP/OpenAPI relay
- broad Streamable HTTP MCP discovery and tool calls
- narrow legacy capabilities retained only for migrated prototype wrappers
- trusted-runtime, job-scoped environment leases for existing CLIs and SDKs

Adapter leases preserve the existing trusted Codex boundary. They remove
persistent Railway credentials but do not hide values from the assigned child
job. Use proxied HTTP/MCP profiles for less-trusted or external runtimes.

## Production Proof

The `prism-stack` pilot validated:

- Portal/Payload administrator access
- Plausible, Arcade, Calendar, Product Ideation, and Hivemind
- broad NextCRM and Clawbank MCP catalogs
- S3, X OAuth, Bankr, wallet, and GitHub compatibility leases
- authenticated GitHub API and Git operations after persistent token removal
- Discord full-access use and Site Console use
- bare-key/legacy profile resolution without protocol metadata
- direct adapter invocation rejection before DNS/network access

The migration planner reports no remaining organization integration credentials
or unclassified sensitive variables in Codex Runtime. Runtime/service bootstrap
credentials such as Prism API auth, Gateway caller auth, communication adapter
auth, and model-provider auth remain with their owning services.

## Invariants

- Secrets enter through Site Settings, never chat or `/agent/*` routes.
- Gateway create/list/audit responses never return stored plaintext.
- Only the Runtime-only lease endpoint returns adapter values.
- Adapter profiles are not network destinations.
- Runtime children never receive the long-lived Gateway caller token.
- Site/source policy assigns profiles; Gateway does not duplicate downstream RBAC.
- Audit summaries may contain profile, operation/tool, and environment names,
  but never values, authorization headers, or request argument bodies.
- Generic skills remain portable. Instance workflows may name required profiles.

## Priority Follow-Ups

### Before Broad Template Rollout

- [x] Add Prism Doctor checks for missing, disabled, or protocol-mismatched
  connected services.
- [x] Add authenticated SQLite snapshots with checksums and encryption-version
  manifests, plus a tested offline restore runbook.
- [x] Add transactional, idempotent master-key rotation with current/previous
  key support and health diagnostics for unavailable versions.
- [x] Finish template migration documentation for adding the Gateway service,
  volume, caller tokens, and Site/Runtime references to existing instances.
- Add end-to-end tests for Console, workflow, task, Discord full-access, and
  read-only policy assignment.

### Authorization Hardening

- Replace trust in the Runtime parent's requested profile list with a
  Site-signed, short-lived assignment assertion or Gateway-issued job session.
- Bind leases to runtime job ID, caller identity, profile keys, and expiration.
- Add separate caller identities and profile assignments when introducing a
  second runtime or external agent host.
- Keep compatibility leases disabled for runtimes that should never receive
  provider values.

### Operations And UX

- Add provider-aware health checks or a runtime callback so `leased` can be
  distinguished from downstream-authenticated health without overstating it.
- Keep normal Settings focused on Connections and Connected Services. Put
  protocol, bindings, assignment sources, and legacy capabilities in Advanced
  diagnostics only when operators need them.
- Add audit filtering/export, retention settings, and redacted diagnostics.
- Generalize the environment import manifest so instances can add mappings
  without changing template source.
- Add connection/profile rename and full profile editing in Site.

### Protocol Refinements

- Add OpenAPI caching, refresh state, and discovery diagnostics.
- Add MCP initialize/session negotiation for servers that require stateful
  sessions beyond the stateless servers proven in the MVP.
- Prefer provider-issued short-lived credentials where available, such as
  GitHub App installation tokens or AWS STS, over leasing static credentials.
- Add first-class OAuth authorization/refresh UX where providers support it.

### Deliberately Deferred

- Gateway-owned application RBAC or route denylist duplication
- workflow approval enforcement inside Gateway
- model routing and optimization
- x402/MPP charging, budgets, and settlement
- Vault, Composio, Toolhouse, or agentgateway dependencies
- external marketplace exposure and multi-tenant SaaS control planes

## Regression Matrix

Before merging a Gateway change, verify:

1. Gateway, Site, Codex Runtime, Task Runner, and source-adapter test suites pass.
2. Missing/invalid caller tokens are rejected.
3. HTTP origin and auth cannot be overridden.
4. MCP describe and a read-only tool call succeed.
5. An adapter profile leases by full descriptor and bare key.
6. Direct adapter invocation returns `TOOLSET_ADAPTER_NOT_INVOKABLE`.
7. A child job receives assigned environment names but not the Gateway token.
8. An unassigned/read-only source context does not receive admin profiles.
9. Audit records contain no credential values or argument bodies.
10. Restart persistence and post-removal provider behavior still pass.
11. A snapshot opens cleanly and decrypts credentials with its documented key.
12. A rotation drill re-encrypts old rows, is idempotent, and leaves health clean
    after the previous key is removed.

## Recommended Next Slice

Do not expand provider adapters first. Doctor and the operations contract are
complete. The next highest-value security slice is assignment attestation and
short-lived job sessions, after the rollout regression matrix has been exercised
on a clean instance and the existing `prism-stack` instance.
