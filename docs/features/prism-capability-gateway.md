# Prism Credential Gateway

Status: MVP implemented; retained as architecture and future direction

Implementation plan: [Prism Gateway MVP Implementation Plan](./prism-gateway-mvp-implementation-plan.md)

Post-MVP handoff: [Prism Gateway Post-MVP Handoff](./prism-gateway-post-mvp-handoff.md)

Runtime boundary: [Prism Runtime Adapter Contract](../architecture/runtime-adapter-contract.md)

## Current Decision

Prism Gateway is primarily encrypted credential and instance-configuration
custody for trusted Prism jobs. It must not become a second implementation of
every connected API, RBAC system, workflow approval model, provider schema, or
egress policy.

The primary user abstraction is a **credential bundle**:

```text
key: plausible-production
encrypted: PLAUSIBLE_API_KEY
configuration:
  PLAUSIBLE_BASE_URL=https://analytics.example.org
  PLAUSIBLE_SITE_ID=example.org
```

A trusted runtime or Task Runner job receives only the bundles assigned to that
job as conventional environment variables. Existing skills, SDKs, scripts, and
CLIs keep their normal provider contract and require no Prism-specific client.
Full-access admin Console and source-adapter contexts discover active bundles
automatically; deterministic tasks and workflows declare credential keys.

Legacy toolset aliases remain accepted during upgrade so existing workflows do
not break. OpenAPI/MCP proxy profiles, per-operation capabilities, grants, and
egress restrictions are advanced compatibility mechanisms, not the default
model or normal Settings UX. Add them only for a concrete less-trusted caller
boundary.

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
2. Trusted runtimes receive job-scoped conventional environment variables and
   do not persist organization credentials in Railway configuration.
3. Skills, scripts, SDKs, OpenAPI documents, and MCP servers continue to define
   provider behavior instead of being manually re-described in Gateway.
4. Site and existing source-adapter policy decide which users, channels, roles,
   workflows, and runtimes receive credentials.
5. Downstream applications remain authoritative for their own RBAC and request
   validation.
6. Gateway records a redacted lease trail sufficient to diagnose credential use.
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
- Build provider-specific presets into the core credential form.
- Require generic or externally sourced skill repositories to adopt Prism
  metadata.

These may be explored later only after credential custody and broad toolset
access prove useful in production.

## Core Model

### Credential Bundle

A credential bundle stores one integration identity:

```text
key: portal-main
auth: payload-login
encrypted secrets:
  email
  password
configuration:
  PORTAL_BASE_URL=https://portal.example.org
```

Gateway owns encrypted storage, non-secret instance configuration, rotation,
revocation, job-scoped leasing, and redacted lease audit.

The assigned trusted agent remains free to use its normal skill, CLI, SDK, or
API client. The provider remains authoritative for authorization and request
validation. Base URLs and other non-secret configuration live beside the
credential so they are not duplicated across skills.

This boundary is **job-scoped environment custody**:

```text
encrypted at rest -> selected for job -> injected into child environment -> discarded
```

Gateway does not promise secrecy from the trusted job receiving a credential.
Use a proxy or provider-issued scoped/short-lived identity when the execution
host itself must not receive a provider value.

### Legacy Toolset Profile

This section documents the compatibility proxy retained for existing deployed
instances. It is not required for normal credential authoring.

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

For the trusted Codex Runtime compatibility path, an `adapter` profile may map
encrypted secret names to conventional environment names. Gateway leases those
values to the assigned child job and audits the profile plus variable names.
The profile cannot be invoked as an HTTP/MCP destination. This preserves
existing skills and CLIs while moving durable custody out of Runtime.

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

Site owns credential assignment. Existing source-adapter policy remains the first
interactive access layer:

```text
Discord read-only channel -> no organization credentials by default
Discord full channel      -> active credential catalog
Telegram target/user      -> credentials resolved by source policy
Admin Console             -> active credential catalog
Workflow/task             -> credential keys explicitly required by instance config
```

Gateway receives the resolved credential keys from an authenticated trusted
caller and returns a job-scoped environment bundle. Stronger signed assignment
attestation is deferred until a second or less-trusted runtime requires it.

Gateway does not duplicate Discord roles, Telegram policy, Site users, or
workflow approvals.

### Skills

Generic skills explain how to use a provider without depending on Prism
Gateway metadata. Site policy supplies active credentials to full-access
interactive contexts. Deterministic tasks and workflows declare instance-owned
credential assignments:

```json
{
  "gatewayCredentials": ["portal-main"]
}
```

Instance-owned skills may use `metadata.gateway-credentials` when dependency
inheritance is useful. Generic and externally sourced skills only document the
environment variables they expect. During migration, `gatewayToolsets` and
`metadata.gateway-capabilities` remain accepted for existing jobs.

Skills do not contain provider credentials and do not become the canonical copy
of an OpenAPI or MCP specification.

## Legacy Proxy Invocation

The following proxy modes remain implemented for compatibility. Trusted jobs
normally call providers directly with their leased environment bundle.

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
- caller service authentication
- job-scoped environment leasing
- reusable non-secret instance configuration
- secret redaction
- credential replacement and revocation
- basic lease audit

When an advanced proxy is explicitly configured, Gateway also owns that
profile's fixed destination, authentication injection, and relay audit.

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
tasks, hooks, requests, approvals, and admin UI. Site resolves which credentials
a job or interactive session receives.

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

1. Ask Prism chat to prepare a credential and its non-secret configuration, or
   select **Add credential** in Settings.
2. Chat returns a Settings deep link when it prepared the entry.
3. An admin enters the secret outside model context.
4. Admin Console and full-access source contexts discover it automatically.
5. Deterministic tasks and workflows assign its stable key.

Settings shows one Credentials table and generic forms. Audit and environment
import live under Advanced. Legacy protocols, capabilities, grants, and egress
controls are not part of the normal UI. Credentials are never accepted through
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
credential_bundles
encrypted_secrets
audit_events
legacy_toolset_capability_and_grant_records
```

Railway retains only bootstrap secrets: the Gateway master encryption key and
caller service tokens.

## Compatibility With The Initial Prototype

The initial prototype implemented per-operation capabilities, constrained HTTP
and MCP calls, grants, toolset profiles, and a warning-only usage ledger. Keep
those paths working as aliases while credential bundles become the normal model.

Existing keys remain narrow compatibility wrappers:

```text
plausible.stats.query
crm.contact.read
arcade.*.read
```

Do not expand this catalog to mirror broad APIs. Existing profile keys are
backfilled as credential aliases during normal startup.

## Portal Proof

The Portal credential key may remain:

```text
portal.admin
```

Use one dedicated Portal automation identity with administrator scope. Gateway
owns its credential and base configuration. The trusted runtime receives the
job-scoped environment expected by the existing Portal skill and can use the
full admin surface without Gateway reproducing its schema.

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
