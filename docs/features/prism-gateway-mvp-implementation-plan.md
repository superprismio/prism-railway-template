# Prism Gateway MVP Implementation Plan

Status: future feature implementation plan

Related spec: [Prism Capability Gateway](./prism-capability-gateway.md)

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

## Proposed First Capabilities

Start with one read capability and one delivery capability.

### Read Capability

Preferred first read capability:

```text
plausible.query
```

Why:

- low operational risk
- currently requires an API key in agent/runtime context
- useful for analytics, reporting, and content workflows
- easy to model as a structured query and structured result

Fallback read capability:

```text
memory.search
```

Why:

- Prism-native
- does not require a new external account
- useful for proving policy and audit, but less useful for proving external
  secret management

### Delivery Capability

Preferred first delivery capability:

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

Recommended runtime:

- Node/TypeScript Fastify or Express, matching existing service style
- mounted Railway volume at `/data`
- SQLite database at `/data/prism-gateway.sqlite`
- no horizontal scaling in the first version

Required bootstrap env:

```env
NODE_ENV=production
PORT=8794
GATEWAY_SERVICE_TOKEN=
GATEWAY_MASTER_ENCRYPTION_KEY=
SITE_INTERNAL_URL=
SITE_INTERNAL_TOKEN=
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
PRISM_GATEWAY_TOKEN=
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

### Secrets

```text
GET /secrets
POST /secrets
POST /secrets/:id/test
DELETE /secrets/:id
```

Rules:

- never return raw secret values after creation
- encrypt values before writing SQLite
- show provider, label, capabilities, last-used timestamp, and health
- support deletion/revocation in the MVP
- rotation can be implemented as create-new plus delete-old in the first slice

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

The MVP can use service-token auth for all gateway API calls.

Headers:

```text
x-gateway-token: <token>
```

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

## First Migration Candidate

Recommended first secret to move:

```text
PLAUSIBLE_API_KEY
```

Reason:

- read-only
- useful in content/reporting workflows
- low blast radius
- easier to validate than write APIs

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

- [ ] Add this implementation plan.
- [ ] Add docs link from the broad gateway spec.
- [ ] Decide first read and delivery capabilities.
- [ ] Decide service name and Railway volume mount.

### Phase 1: Service Skeleton

- [ ] Add `services/prism-gateway`.
- [ ] Add health endpoint.
- [ ] Add SQLite migration runner.
- [ ] Add `/data` volume expectation.
- [ ] Add service-token auth middleware.
- [ ] Add `.env.example` and template variable references.

### Phase 2: Capability Catalog And Secrets

- [ ] Seed built-in capabilities.
- [ ] Add encrypted secret create/list/delete.
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

## Open Decisions Before Implementation

1. Should the first gateway service use Express for consistency with adapter
   services, or Fastify for stricter schema-driven route handling?
2. Should the first read capability be `plausible.query` or `memory.search`?
3. Should the first delivery capability be `comms.discord.send_message` or a
   lower-risk artifact write capability?
4. Should actor profiles initially mirror existing Prism roles or use separate
   gateway-local profiles?
5. Should audit events be copied back to Prism Site request artifacts when a
   request id is present?
6. Should the gateway eventually expose MCP-compatible tools, or should MCP
   remain behind runtime-specific adapters until the first HTTP gateway proves
   useful?
