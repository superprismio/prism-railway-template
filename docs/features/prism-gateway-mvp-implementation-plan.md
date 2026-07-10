# Prism Gateway MVP Implementation Plan

Status: future feature implementation plan

Related spec: [Prism Capability Gateway](./prism-capability-gateway.md)

Runtime contract: [Prism Runtime Adapter Contract](../architecture/runtime-adapter-contract.md)

Migration runbook: [Prism Gateway Migration](../operations/prism-gateway-migration.md)

## Purpose

Define the first buildable slice of `prism-gateway` without turning the current
template into a large refactor. The MVP should prove that Prism can move a small
set of integration capabilities out of individual runtimes and into a dedicated
policy, secret, audit, and usage boundary.

The first version is additive:

- existing services keep working without the gateway
- no existing internal service call is forced through the gateway
- no external SaaS dependency such as Vault, Composio, Toolhouse, or
  agentgateway is required
- Railway remains the bootstrap secret source
- gateway state follows the current mounted-volume plus SQLite template pattern

## MVP Outcome

After the MVP, an operator should be able to:

1. deploy an optional `prism-gateway` service beside the existing stack
2. configure one or two integration secrets through a Prism admin UI
3. allow selected actors or services to invoke selected capabilities
4. see audit events for every gateway invocation
5. see warning-only usage and budget events
6. remove at least one duplicated integration secret from `codex-runtime` or
   another runtime service

The MVP is successful if the gateway becomes useful for a small number of
real capabilities without blocking current workflows.

The first vertical slice is successful when:

```text
Prism admin enters a Plausible credential in Settings
  -> site sends it server-side to prism-gateway
  -> prism-gateway encrypts it on its mounted volume
  -> codex-runtime invokes plausible.query without receiving the credential
  -> prism-gateway records the policy decision, result status, and usage
```

The production `prism-stack` instance does not currently expose a Plausible
credential to its Railway services. This is therefore a new low-risk connection
proof, not the first removal of an existing Codex Runtime variable. After the
connection and invocation path is stable, use the same framework to migrate one
existing read-oriented integration credential from Codex Runtime.

## Locked MVP Decisions

- `prism-gateway` is a new optional Railway service.
- Use Node, TypeScript, and Express to match existing runtime and adapter
  services.
- Use SQLite at `/data/prism-gateway.sqlite` on a single mounted volume.
- Site remains authoritative for users, roles, skills, workflows, requests,
  runtime profiles, and browser admin sessions.
- Gateway owns integration connections, encrypted credentials, capability
  grants, invocation, audit, and warning-only usage.
- Use one gateway service token per calling service. Gateway maps the token to a
  trusted caller identity; request JSON cannot select or override that identity.
- Treat user, agent, request, and workflow fields as delegation context.
- Seed fixed built-in capability definitions. MVP admins may enable, disable,
  and grant them but may not author arbitrary executable capabilities.
- Require an idempotency key for delivery, write, and destructive capabilities.
- A compatibility fallback may handle a disabled integration or an unavailable
  legacy route. It must never bypass gateway authentication, policy, approval,
  budget, or destination denials.
- Use AES-256-GCM with a versioned key reference, nonce, authentication tag, and
  authenticated connection metadata.
- Keep budgets in warning mode and defer payment settlement.
- Preserve current Codex Runtime routes while adding the shared runtime adapter
  contract.

## First Capabilities

Start with one read capability and one delivery capability.

### Read Capability

Locked first read capability:

```text
plausible.query
```

Why:

- low operational risk
- currently requires an API key in agent/runtime context
- useful for analytics, reporting, and content workflows
- easy to model as a structured query and structured result

Development fallback when no Plausible account is available:

```text
memory.search
```

Why:

- Prism-native
- does not require a new external account
- useful for proving policy and audit, but less useful for proving external
  secret management

### Follow-Up Delivery Capability

First delivery capability after the read vertical slice:

```text
comms.discord.send_message
```

Why:

- already exists behind the communication adapter
- should not move Discord bot protocol logic into the gateway
- useful for proving gateway-to-adapter delegation
- can be scoped by destination, actor, and request context

Fallback delivery capability:

```text
storage.artifact.write
```

Why:

- lower external blast radius
- useful for audit and artifact creation
- less representative of third-party delivery policy

## Railway Service Shape

Add an optional service:

```text
prism-gateway
```

Runtime:

- Node/TypeScript with Express, matching existing service style
- mounted Railway volume at `/data`
- SQLite database at `/data/prism-gateway.sqlite`
- no horizontal scaling in the first version

Required bootstrap env:

```env
NODE_ENV=production
PORT=8794
GATEWAY_MASTER_ENCRYPTION_KEY=
GATEWAY_SITE_TOKEN=
GATEWAY_CODEX_RUNTIME_TOKEN=
GATEWAY_TASK_RUNNER_TOKEN=
```

Optional adapter env for MVP capabilities:

```env
COMMS_INTERNAL_URL=
COMMS_INTERNAL_TOKEN=
PRISM_MEMORY_INTERNAL_URL=
PRISM_MEMORY_INTERNAL_TOKEN=
```

Optional runtime env added to callers:

```env
PRISM_GATEWAY_BASE_URL=
PRISM_GATEWAY_TOKEN= # caller-specific token reference
```

The gateway should not require all downstream internal URLs at boot. Missing
downstream config should disable only the capabilities that need it.

## Initial API

### Health

```text
GET /health
```

Returns service status, database status, and enabled downstream adapters.

### Capabilities

```text
GET /capabilities
POST /capabilities
PATCH /capabilities/:key
```

MVP can seed built-in capabilities on migration and allow admin enable/disable.
Full user-authored capability schemas can come later.

### Connections

```text
GET    /connections
POST   /connections
POST   /connections/:id/test
PUT    /connections/:id/credentials
DELETE /connections/:id
```

Rules:

- never return raw secret values after creation
- encrypt values before writing SQLite
- show provider, label, capabilities, last-used timestamp, and health
- support deletion/revocation in the MVP
- replacing credentials updates the connection without changing its stable id
- encrypted secret records remain an internal storage detail and have no generic
  plaintext read API

### Grants

```text
GET /grants
PUT /grants/:id
```

MVP grants bind a Site-owned runtime, role, user, or agent identifier to a fixed
capability. Gateway does not create a second user directory.

### Invoke

```text
POST /invoke
```

Example request:

```json
{
  "capability": "plausible.query",
  "input": {
    "siteId": "example.org",
    "period": "7d",
    "metrics": ["visitors", "pageviews"]
  },
  "context": {
    "actor": "content-agent",
    "runtime": "codex-runtime",
    "initiatedBy": "user:123",
    "requestId": "344",
    "workflowRunId": "wf_run_abc",
    "workflowStepKey": "synthesize"
  }
}
```

Example response:

```json
{
  "ok": true,
  "traceId": "gw_trace_01",
  "capability": "plausible.query",
  "result": {
    "visitors": 123,
    "pageviews": 456
  },
  "usage": {
    "units": 1,
    "estimatedCost": 0.01,
    "budgetStatus": "within_budget"
  }
}
```

### Audit

```text
GET /audit-events
GET /audit-events/:traceId
```

Filter by:

- actor
- capability
- request id
- workflow run id
- status
- date range

## Authentication

The MVP uses service-token auth for gateway service calls. Tokens are distinct
per caller so the gateway can derive trusted caller identity from the presented
credential.

Headers:

```text
x-gateway-token: <caller-specific-token>
```

The gateway token record determines trusted fields such as:

```text
caller service: codex-runtime
runtime identity: codex-default
allowed delegation sources: site, task-runner
```

The request body may carry delegated actor, user, request, workflow, and task
context. It may not override the authenticated caller or runtime identity.

Admin UI calls should go through `site`, not directly from the browser to
`prism-gateway`, unless and until a gateway admin session model exists.

Future versions can add:

- per-runtime tokens
- per-agent scoped tokens
- signed invocation context
- external agent API keys
- OAuth-based admin connection flows

## Policy MVP

Start with explicit allow rules.

Suggested policy fields:

```text
actor_id
runtime_id
capability_key
allowed
requires_approval
allowed_destinations_json
max_units_per_day
created_at
updated_at
```

The first policy engine should answer:

1. is the token allowed to call the gateway?
2. is the actor/runtime allowed to invoke this capability?
3. does the capability require approval?
4. if destination-scoped, is the destination allowed?
5. should usage be warning-only or blocked?

Approval enforcement can initially be advisory for low-risk capabilities and
strict only for explicitly configured high-risk capabilities.

## Database Sketch

Use additive migrations.

```text
capabilities
  key text primary key
  provider text not null
  mode text not null
  description text not null
  input_schema_json text
  output_schema_json text
  risk_level text not null
  requires_approval integer not null default 0
  default_unit_price real not null default 0
  enabled integer not null default 1
  created_at text not null
  updated_at text not null

integration_connections
  id text primary key
  provider text not null
  label text not null
  auth_type text not null
  status text not null
  last_tested_at text
  last_used_at text
  created_at text not null
  updated_at text not null

encrypted_secrets
  id text primary key
  connection_id text not null
  secret_name text not null
  encrypted_value text not null
  nonce text not null
  created_at text not null
  updated_at text not null

actor_profiles
  id text primary key
  label text not null
  kind text not null
  created_at text not null
  updated_at text not null

profile_capabilities
  profile_id text not null
  capability_key text not null
  policy_json text not null
  created_at text not null
  updated_at text not null

audit_events
  id text primary key
  trace_id text not null
  capability_key text not null
  actor_id text
  runtime_id text
  request_id text
  workflow_run_id text
  workflow_step_key text
  status text not null
  policy_decision text not null
  budget_decision text
  latency_ms integer
  error text
  input_summary_json text
  output_summary_json text
  created_at text not null

usage_ledger
  id text primary key
  trace_id text not null
  capability_key text not null
  actor_id text
  request_id text
  units real not null
  unit_price real not null
  estimated_cost real not null
  actual_cost real
  settlement_status text not null
  created_at text not null

budget_limits
  id text primary key
  scope_type text not null
  scope_id text not null
  capability_key text
  window text not null
  max_units real
  max_estimated_cost real
  enforcement_mode text not null
  created_at text not null
  updated_at text not null
```

## Encryption MVP

Use Node crypto with an authenticated encryption mode such as AES-256-GCM.

Rules:

- `GATEWAY_MASTER_ENCRYPTION_KEY` must be generated by Railway/template setup
- store one nonce per encrypted value
- never log plaintext secrets
- never include plaintext secrets in audit events
- hide secret values in admin responses

Key rotation can be a future feature. The first version should document that
changing the master key invalidates existing encrypted secrets unless a rotation
process is added.

## Site Admin UI

Keep UI inside Prism Site at first.

Add a Settings section:

```text
Settings -> Gateway
```

First panels:

- gateway health
- enabled capabilities
- integration connections
- add/test/delete secret
- actor/profile capability grants
- recent audit events
- warning-only budget view

Site should call gateway server-side using:

```env
PRISM_GATEWAY_BASE_URL=
PRISM_GATEWAY_TOKEN=
```

Do not expose gateway service tokens to the browser.

## Runtime Integration

Add a small gateway client helper to services that invoke capabilities.

Initial callers:

- `codex-runtime`
- `task-runner`
- `site` for admin test actions

Recommended helper shape:

```text
invokeGatewayCapability({
  capability,
  input,
  context,
})
```

Codex Runtime should not be migrated wholesale. Start by moving one integration
key or one tool path to the gateway and leave the rest unchanged.

Runtime job submission is a separate boundary from capability invocation. The
runtime adapter contract normalizes submit, status, cancellation, output,
artifacts, and errors. Gateway does not become the runtime job dispatcher.

## First Migration Candidate

Recommended first connection to prove:

```text
PLAUSIBLE_API_KEY
```

Reason:

- read-only
- useful in content/reporting workflows
- low blast radius
- easier to validate than write APIs

This credential is not currently present on the production `prism-stack`
services. After proving UI-managed connection storage and invocation, select an
existing read-oriented Codex Runtime integration for the first actual removal.
Do not choose a private key, social publishing credential, or broad object
storage credential for the first migration.

Provisional production migration candidate:

```text
crm.contact.read
```

The production inventory found an existing CRM connection in Codex Runtime, and
a narrowly modeled read capability matches the security goals better than
passing a broad CRM or MCP token through to the runtime. Confirm the provider's
read endpoint and token scope before locking this migration. If the available
credential grants broad write access and cannot be constrained, choose another
read-oriented integration.

Recommended first adapter delegation:

```text
comms.discord.send_message
```

Reason:

- keeps Discord bot token inside communication adapter
- gateway only needs a scoped adapter token
- proves actor/destination policy without moving all comms secrets

## Usage And Budgets

The first version should create usage ledger rows for every invocation but
enforce budgets only in warning mode.

Budget enforcement modes:

```text
off
warn
block
```

MVP default:

```text
warn
```

Warnings should appear in:

- invoke response
- gateway audit event
- site admin gateway panel

Blocking can wait until the usage data is trustworthy.

## Observability

Every invocation should generate:

- `traceId`
- audit event
- usage ledger row
- structured service log line

For failed calls, preserve:

- policy decision
- downstream provider status
- timeout reason
- redacted input summary

For successful calls, preserve:

- latency
- provider
- units
- redacted output summary

## Implementation Phases

### Phase 0: Documentation And Template Shape

- [x] Add this implementation plan.
- [x] Add docs link from the broad gateway spec.
- [x] Define the runtime adapter contract.
- [x] Lock the first read and follow-up delivery capabilities.
- [x] Decide service name and Railway volume mount.
- [x] Add migration, environment delta, rollback, and production preflight docs.

### Phase 1: Service Skeleton

- [ ] Add `services/prism-gateway`.
- [ ] Add health endpoint.
- [ ] Add SQLite migration runner.
- [ ] Add `/data` volume expectation.
- [ ] Add service-token auth middleware.
- [ ] Add `.env.example` and template variable references.

### Phase 2: Capability Catalog And Connections

- [ ] Seed built-in capabilities.
- [ ] Add connection create/list/test/replace/revoke.
- [ ] Keep encrypted secret rows internal and redact admin responses.
- [ ] Add integration connection records.
- [ ] Add one secret test route.
- [ ] Add admin-safe response redaction.

### Phase 3: Invoke And Audit

- [ ] Add `POST /invoke`.
- [ ] Add policy check.
- [ ] Add audit event writes.
- [ ] Add usage ledger writes.
- [ ] Add timeout handling for downstream calls.

### Phase 4: First Capabilities

- [ ] Implement `plausible.query` or `memory.search`.
- [ ] Implement `comms.discord.send_message`.
- [ ] Add capability-specific input validation.
- [ ] Add capability-specific output normalization.

### Phase 5: Site Admin UI

- [ ] Add Settings -> Gateway.
- [ ] Show gateway health.
- [ ] Show capabilities.
- [ ] Add/test/delete integration secret.
- [ ] Show audit events.
- [ ] Show usage warnings.

### Phase 6: Runtime Client

- [ ] Add gateway client helper.
- [ ] Wire one runtime/tool path through the gateway.
- [ ] Remove one duplicated secret from runtime env docs.
- [ ] Keep direct fallback available until stable.

## Non-Goals

- No Vault requirement.
- No Composio or Toolhouse dependency.
- No agentgateway dependency.
- No x402/MPP settlement.
- No full secret migration.
- No multi-instance SaaS tenancy.
- No replacement of site, memory, or adapters.
- No direct browser calls to gateway with service credentials.

## Deferred Decisions

These decisions do not block the first vertical slice:

1. Does the existing CRM connection support a sufficiently narrow
   `crm.contact.read` contract and credential scope for the first removal?
2. Should request-linked audit summaries later be copied into Site artifacts?
3. Should gateway tools gain an MCP surface after the HTTP invocation API is
   stable?
4. Which second runtime is useful enough to validate adapter portability?
5. When should warning-only budgets become enforceable limits?
