# Prism Gateway MVP Implementation Plan

Status: complete (2026-07-11)

Related spec: [Prism Credential And Toolset Gateway](./prism-capability-gateway.md)

Runtime contract: [Prism Runtime Adapter Contract](../architecture/runtime-adapter-contract.md)

Migration runbook: [Prism Gateway Migration](../operations/prism-gateway-migration.md)

Post-MVP handoff: [Prism Gateway Post-MVP Handoff](./prism-gateway-post-mvp-handoff.md)

## Scope Correction

The initial prototype treated per-operation capabilities and Gateway-owned
schemas as the central abstraction. That worked for Plausible, Arcade reads, and
a constrained CRM contact read, but it does not scale to broad systems such as
Portal/Payload with dozens of collections and an administrator API.

The corrected MVP makes credential-backed **toolset profiles** primary:

```text
connection + fixed destination + authentication
  -> OpenAPI, MCP, HTTP, or adapter tool surface
  -> profile such as portal.admin
  -> assignment by Site/source policy
  -> runtime access without the long-lived credential
```

Gateway does not duplicate downstream RBAC, workflow approvals, operation
schemas, destructive-action policy, or budgets in the first version.

Existing per-operation capability routes remain operational as compatibility
wrappers. Do not add wrappers for every Portal collection or API route.

## MVP Outcome

The corrected MVP success criteria are complete:

1. [x] An admin can store, import, replace, and revoke organization credentials
   through Site without Railway access.
2. [x] Gateway binds proxied credentials to fixed downstream destinations.
3. [x] Gateway relays broad HTTP/OpenAPI surfaces and discovers/calls broad MCP
   tool catalogs without copying provider schemas.
4. [x] Site assigns named profiles to Console, source-policy contexts,
   workflows, tasks, and runtime jobs.
5. [x] Proxied profiles keep provider credentials out of the runtime; trusted
   compatibility profiles remove persistent credentials and lease them only to
   an assigned child job under the existing runtime trust boundary.
6. [x] Gateway records redacted profile, operation/tool or lease, caller,
   status, latency, and job context.
7. [x] Production credentials were removed from Codex Runtime without reducing
   Portal, analytics, CRM, MCP, S3, X, Bankr, wallet, or GitHub behavior.

The decisive broad-profile proofs are `portal.admin`, `nextcrm.admin`, and the
job-scoped compatibility profiles. The production migration planner reports no
remaining organization integration credentials or unclassified sensitive
variables in Codex Runtime.

## Easy Mode

The default operator flow is:

1. ask Prism chat to connect an integration
2. the Gateway authoring skill creates non-secret connection/profile metadata
3. chat returns a Settings deep link
4. an admin enters the credential outside model context
5. Gateway tests authentication and discovers tools from OpenAPI or MCP
6. the profile is assigned through existing Site/runtime/source policy
7. Console and chat use the discovered tools normally

Credentials are never accepted through chat or `/agent/*`.

Connection internals, credential bindings, spec URLs, and discovery diagnostics belong
under Advanced settings. Operators should not manually create one capability per
API operation.

## Access Model

Site and existing source-adapter policy own assignment:

```text
readonly Discord/Telegram context -> configured read-oriented profiles
full Discord/Telegram context     -> configured full/admin profiles
admin Console                     -> enabled admin profiles
workflow/task                     -> profiles explicitly required by instance config
```

Gateway checks only whether the authenticated runtime session was assigned the
requested profile. The downstream service enforces the permissions of the
credential associated with that profile.

For example, `portal.admin` intentionally exposes the authority of a dedicated
Portal administrator account. A future `portal.editor` should use a downstream
editor identity or scoped token rather than a Gateway-maintained route denylist.

## Data Model

### Connections

Required fields:

```text
key
provider
label
fixed_origin_or_endpoint
auth_recipe
encrypted_secret_refs
status
last_tested_at
last_used_at
```

### Toolset Profiles

Required fields:

```text
key
connection_id
protocol: openapi | mcp | http | adapter
discovery_url_or_path
description
enabled
last_discovered_at
discovery_error
```

### Assignments

Assignments bind a runtime, service, or Site-resolved policy profile to a
toolset key. The MVP does not require Gateway to store Discord channel IDs or
Site role rules; Site resolves those into a job/session assignment.

### Audit

Record:

```text
trace_id
authenticated_caller
delegated_actor
toolset_profile
operation_or_tool
request/workflow/task context
status
latency
redacted_error
created_at
```

Do not log request authorization headers, provider credentials, Gateway session
tokens, or secret-bearing response bodies.

## Protocol Adapters

### OpenAPI

- expose the specification from a fixed configured location
- let skills and runtimes inspect the specification when needed
- provide a generic fixed-origin request relay
- inject connection authentication
- keep origin fixed
- let the downstream service validate request bodies and enforce RBAC

Do not persist a second normalized operation catalog or manually reproduce
operation schemas in Gateway. Skills provide domain guidance and may identify
useful operation IDs, but the downstream specification remains canonical.

### MCP

- connect to a fixed Streamable HTTP MCP endpoint
- inject connection authentication
- discover the server's tool catalog
- relay tool calls and normalize responses
- refresh discovery when the server catalog changes

Do not require a manually maintained Gateway copy of the MCP tool list for broad
profiles.

### Fixed-Origin HTTP

- allow an assigned profile to send method, path, query, and body to one fixed
  origin
- inject authentication
- prevent caller-controlled origin or auth overrides
- preserve downstream response semantics with bounded transport limits
- do not require the path or operation to appear in an OpenAPI document

Use this when an integration has no usable OpenAPI or MCP document. Do not turn
it into a second provider SDK.

The same broad relay behavior applies to OpenAPI profiles. OpenAPI improves
agent discovery but does not constrain the agent to a Gateway-maintained route
or operation allowlist.

### Adapter

Delegate to existing Prism adapters when they already own protocol behavior.
Gateway may broker the adapter service credential but does not replace Discord,
Telegram, SendGrid, source ingestion, or Prism Memory logic.

The MVP also supports a trusted-runtime compatibility lease. Gateway maps an
adapter profile's encrypted secret names to established environment names and
leases them only to the assigned Codex child job. Adapter profiles are not
callable HTTP/MCP destinations and are rejected before network resolution.

## Portal Vertical Slice

### Profile

```text
portal.admin
```

### Connection

- one dedicated Portal automation identity
- administrator scope
- fixed Portal origin
- Payload authentication established inside Gateway
- one canonical identity replaces the normal and Queen credentials unless a
  separate downstream persona is demonstrably required

### Tool Surface

Prefer a Portal-owned OpenAPI document. If Payload does not currently expose a
complete useful document, improve Portal's API description rather than manually
building 30 collection definitions in Gateway.

The profile may use every operation exposed to its downstream administrator
identity. Gateway does not block users, auth, access-control, delete, or publish
routes merely because they are powerful.

### Assignment

- Admin Console: assigned
- configured full-access Discord/Telegram contexts: assigned
- read-only contexts: not assigned
- workflows using `rg-portal-ops`: assigned through skill metadata

### Success Checks

- Portal credentials absent from Codex Runtime
- Portal OpenAPI tools discoverable through Gateway
- representative read, draft, publish, event, artifact, and administration
  operations work
- existing Portal workflows require no per-collection Gateway declarations
- downstream Portal RBAC remains authoritative
- Gateway audit contains profile and operation without secrets

## Existing Prototype

Completed and retained:

- [x] optional `prism-gateway` Railway service
- [x] mounted SQLite storage
- [x] encrypted credential create/replace/revoke
- [x] caller-specific service authentication
- [x] Settings Gateway UI and credential deep links
- [x] runtime sessions and source-policy integration
- [x] skill-declared Gateway requirements
- [x] basic audit trail
- [x] constrained HTTP and MCP compatibility wrappers
- [x] Plausible, NextCRM contact-read, and Arcade production pilots
- [x] first runtime credential removal

Prototype features that are not the corrected MVP center:

- per-operation capability schemas
- Gateway risk labels
- warning-only usage ledger
- default-deny per-capability grants

Keep them compatible, but do not expand them until the toolset-profile proof is
complete.

## MVP Implementation Record

### Phase A: Profile Contract

- [x] Add toolset-profile types and persistence.
- [x] Add create/list/update/disable profile APIs.
- [x] Add profile assignments compatible with existing runtime sessions.
- [x] Add `metadata.gateway-toolsets` skill parsing.
- [x] Keep `metadata.gateway-capabilities` compatibility.
- Deferred: add Doctor checks for missing or disabled required toolsets.

### Phase B: Toolset Relay

- [x] Expose a fixed OpenAPI document through an assigned toolset session.
- [x] Implement a broad authenticated same-origin JSON request relay.
- [x] Let skills and runtimes perform API-specific discovery from the canonical specification.
- [x] Implement broad MCP discovery using the fixed connection endpoint.
- [x] Expose discovered tool descriptors to Codex Runtime.
- Deferred: add persisted refresh state and richer discovery-error reporting.

### Phase C: Relay

- [x] Invoke broad same-origin operations through the fixed connection.
- [x] Relay arbitrary discovered MCP tools through the fixed connection.
- [x] Add fixed-origin HTTP relay for integrations without discovery.
- [x] Inject authentication for proxied profiles without exposing it to the runtime.
- [x] Add job-scoped compatibility leases for trusted runtime tools and CLIs.
- [x] Audit profile operations, MCP tools, and compatibility leases.

### Phase D: Portal Proof

- [x] Use Portal's broad authenticated HTTP surface without per-collection Gateway schemas.
- [x] Configure one `portal.admin` connection and profile.
- [x] Assign `portal.admin` to Portal workflows while keeping generic skills portable.
- [x] Validate Console and full-access Discord use.
- [x] Validate representative existing workflows.
- [x] Remove duplicate Portal credentials from Codex Runtime.

## Explicitly Deferred

- Gateway-owned downstream RBAC
- request/workflow approval enforcement in Gateway
- route-level destructive-action classification
- budgets and pricing
- x402/MPP
- model routing and optimization
- external-agent marketplace exposure
- Vault migration
- Composio, Toolhouse, or agentgateway dependencies
- multi-instance SaaS tenancy
