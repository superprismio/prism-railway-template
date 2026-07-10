# Prism Credential And Toolset Gateway

Status: corrected future feature spec

Implementation plan: [Prism Gateway MVP Implementation Plan](./prism-gateway-mvp-implementation-plan.md)

Runtime boundary: [Prism Runtime Adapter Contract](../architecture/runtime-adapter-contract.md)

## Decision

Prism Gateway is primarily a credential-custody and authenticated tool-access
service. It must not become a second implementation of every connected API,
RBAC system, workflow approval model, or provider schema.

The primary runtime abstraction is a credential-backed **toolset profile**:

```text
portal.admin
crm.admin
github.main
plausible.read
```

A profile binds an authenticated connection to an existing OpenAPI, MCP, or
fixed-origin HTTP tool surface. The downstream service continues to own API
semantics, validation, and RBAC.

Per-operation capabilities such as `crm.contact.read` remain supported as
optional wrappers for unusually small or intentionally restricted integrations.
They are not the default integration model.

## Problem

Prism instances connect to Portal, CRM, Plausible, GitHub, object storage, X,
render services, model providers, MCP servers, and other organization tools.
Long-lived integration credentials currently accumulate in Codex Runtime and
other execution services.

That creates repeated work when an organization adds specialized agents,
multiple runtimes, workflows, or external agent consumers:

- credentials must be copied into several services
- credential rotation requires Railway access
- runtime replacement also requires integration rewiring
- organization tools become coupled to one runtime's environment
- direct interactive use and workflow use drift apart

The first objective is to remove long-lived organization credentials from
runtimes without reducing what trusted agents can do.

## Goals

1. Authorized admins can add, replace, test, and revoke integration credentials
   through Prism without Railway access.
2. Runtimes receive authenticated tool access without receiving long-lived
   provider credentials.
3. Broad integrations retain their existing OpenAPI or MCP surface instead of
   being manually re-described in Gateway.
4. Site and existing source-adapter policy decide which users, channels, roles,
   workflows, and runtimes receive each toolset profile.
5. Downstream applications remain authoritative for their own RBAC and request
   validation.
6. Gateway records a redacted invocation trail sufficient to diagnose credential
   use and integration failures.
7. Codex Runtime becomes one replaceable runtime consumer rather than the owner
   of organization integrations.

## Non-Goals For The First Version

- Reimplement downstream RBAC in Gateway.
- Classify every API route as read, write, destructive, or approval-required.
- Interpret Prism workflow gates inside Gateway.
- Maintain provider schemas that already exist in OpenAPI or MCP.
- Add budgets, internal pricing, x402, or payment settlement.
- Route models or optimize model selection.
- Replace Site, Prism Memory, communication adapters, or source adapters.
- Force every existing internal service call through Gateway.
- Require Vault, Composio, Toolhouse, or agentgateway.

These may be explored later only after credential custody and broad toolset
access prove useful in production.

## Core Model

### Connection

A connection stores one integration identity:

```text
key: portal-main
provider: portal
origin: https://portal.example.org
auth: payload-login
encrypted secrets:
  email
  password
```

Gateway owns encrypted credential storage, the fixed destination, the
authentication recipe, credential testing, rotation, revocation, and connection
health.

The origin and authentication recipe cannot be overridden by runtime input.
This prevents a caller from forwarding a credential to another host. It is a
credential-isolation rule, not duplicated application RBAC.

### Toolset Profile

A profile exposes an existing tool surface through a connection:

```text
key: portal.admin
connection: portal-main
protocol: openapi
specification: https://portal.example.org/openapi.json
```

Supported protocol shapes:

- `openapi`: discover operations from a fixed OpenAPI document
- `mcp`: discover tools from a fixed Streamable HTTP MCP endpoint
- `http`: fixed-origin request access when no machine-readable tool document
  exists
- `adapter`: delegate to an existing Prism domain adapter

The profile name communicates the authority of the downstream identity. If a
Portal credential is an administrator, `portal.admin` is intentionally broad.
Gateway should not pretend that identity is a restricted editor by maintaining a
fragile route denylist.

When narrower access is needed, create a narrower downstream identity or token:

```text
portal.read
portal.editor
portal.admin
```

The downstream application enforces those distinctions.

### Assignment

Site owns profile assignment. Existing source-adapter policy remains the first
interactive access layer:

```text
Discord read-only channel -> read-oriented profiles only
Discord full channel      -> configured admin/full profiles
Telegram target/user      -> profiles resolved by source policy
Admin Console             -> enabled admin profiles
Workflow/task             -> profiles required by selected skills
```

Gateway receives a short-lived runtime session containing the resolved profile
keys. It verifies only that the authenticated caller session was assigned the
requested profile.

Gateway does not duplicate Discord roles, Telegram policy, Site users, or
workflow approvals.

### Skills

Skills explain how and when to use a toolset. They declare profile dependencies
in standard skill metadata:

```yaml
metadata:
  gateway-toolsets:
    - portal.admin
```

During migration, `metadata.gateway-capabilities` remains accepted for existing
narrow wrappers. Runtimes resolve both forms into short-lived Gateway access.

Skills do not contain provider credentials and do not become the canonical copy
of an OpenAPI or MCP specification.

## Invocation

### OpenAPI

The runtime can read the downstream OpenAPI document through its assigned
profile. Skills use that canonical document for API-specific discovery and send
requests through the profile's generic fixed-origin relay. Gateway injects
authentication but does not maintain a second operation catalog.

```json
{
  "toolset": "portal.admin",
  "request": {
    "method": "POST",
    "path": "/api/posts",
    "body": {
      "title": "Draft title",
      "_status": "draft"
    }
  }
}
```

Gateway does not manually redefine the post schema. Portal validates the body.
If the OpenAPI document includes user administration or delete operations, an
agent assigned `portal.admin` may use them.

### MCP

Gateway connects to the fixed MCP endpoint, injects its credential, exposes the
server's discovered tools, and relays tool calls.

```json
{
  "toolset": "crm.admin",
  "tool": "crm_update_contact",
  "arguments": {
    "id": "...",
    "position": "..."
  }
}
```

Gateway does not maintain a second MCP tool catalog. Optional narrow wrappers
may expose a subset, but broad profiles should use server discovery.

### Fixed-Origin HTTP

When no OpenAPI or MCP surface exists, an assigned HTTP profile may relay
method, path, query, and body to its fixed origin. Authentication headers and
origin remain Gateway-owned. This mode should preserve downstream behavior, not
grow a parallel schema system.

## Gateway Responsibilities

Gateway owns only:

- encrypted credential custody
- fixed connection destination
- provider authentication/session establishment
- caller service authentication
- short-lived profile assignment verification
- safe access to canonical OpenAPI/MCP descriptions and authenticated relay
- secret redaction
- connection health, replacement, and revocation
- basic invocation audit

Basic audit fields:

```text
trace_id
authenticated_caller
delegated_actor
toolset_profile
operation_or_tool
request/workflow/task context when supplied
status
latency
redacted error
created_at
```

Gateway must never log provider credentials, injected authentication headers,
Gateway tokens, or unredacted secret-bearing responses.

## Responsibilities Outside Gateway

### Site

Site owns users, roles, source policy, runtime profiles, skills, workflows,
tasks, hooks, requests, approvals, and admin UI. Site resolves which toolset
profiles a job or interactive session receives.

### Downstream Services

Portal, CRM, GitHub, Payload, and other providers own their native RBAC,
validation, route semantics, and business rules.

### Workflows And Skills

Workflows decide when review or approval is required. Skills encode operating
guidance, safety expectations, and domain-specific usage. Gateway does not read
workflow state to reinterpret downstream authority.

### Domain Adapters

Communication and source adapters retain protocol-specific behavior. Gateway
may hold or broker their service credential, but it does not replace formatting,
destination resolution, event handling, or ingestion logic.

## Site UI

The default operator experience is:

1. Ask Prism chat to configure an integration.
2. Chat creates non-secret connection and toolset configuration.
3. Chat returns a Settings deep link.
4. An admin enters the credential outside model context.
5. Site asks Gateway to test authentication and discover OpenAPI/MCP tools.
6. The admin assigns the profile to Console, source-policy groups, or runtime
   profiles.

Advanced fields such as protocol, spec URL, auth recipe, and discovery state may
be shown under an Advanced disclosure. Credentials are never accepted through
chat or `/agent/*`.

## Storage

The MVP follows the template's mounted-volume and SQLite pattern:

```text
prism-gateway
  volume: /data
  database: /data/prism-gateway.sqlite
```

Core records:

```text
connections
encrypted_secrets
toolset_profiles
profile_assignments_or_grants
discovery_cache
audit_events
```

Railway retains only bootstrap secrets: the Gateway master encryption key and
caller service tokens.

## Compatibility With The Initial Prototype

The initial prototype implemented per-operation capabilities, constrained HTTP
and MCP calls, grants, audit events, and a warning-only usage ledger. Keep those
paths working while the profile model is introduced.

Existing keys remain narrow compatibility wrappers:

```text
plausible.stats.query
crm.contact.read
arcade.*.read
```

Do not expand this catalog to mirror broad APIs. Portal is the first profile-led
integration and the proof that Gateway can preserve a large existing tool
surface without schema duplication.

## Portal Proof

The decisive next profile is:

```text
portal.admin
```

Use one dedicated Portal automation identity with administrator scope. Gateway
owns its credential and authentication session. The runtime receives Portal's
OpenAPI-derived tools and can use the full documented admin surface.

Success criteria:

1. No Portal password is present in Codex Runtime.
2. Admin Console and configured full-access Discord contexts can use the full
   Portal toolset.
3. Read-only Discord contexts do not receive `portal.admin`.
4. Existing Portal skills and workflows continue to work without per-collection
   Gateway definitions.
5. Portal remains the authority for RBAC and payload validation.
6. Gateway audit identifies the profile and downstream operation without
   exposing credentials.

## Deferred Work

After the Portal proof, evaluate only from demonstrated need:

- downstream scoped identity provisioning
- OAuth connection flows
- Vault as an encrypted-secret backend
- agentgateway as an MCP/OpenAPI data plane
- richer audit export
- rate limits or budgets
- external agent exposure
- x402/MPP settlement

These are not prerequisites for moving credentials out of runtimes.
