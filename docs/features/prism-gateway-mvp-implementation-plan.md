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
2. configure one or two instance-specific connections through a Prism admin UI
3. allow selected actors or services to invoke selected capabilities
4. see audit events for every gateway invocation
5. see warning-only usage and budget events
6. remove at least one duplicated integration secret from `codex-runtime` or
   another runtime service

The MVP is successful if the gateway becomes useful for a small number of
real capabilities without blocking current workflows.

The first vertical slice is successful when:

```text
Prism admin creates a read-only HTTP JSON connection in Settings
  -> admin binds an instance capability such as analytics.query
  -> site sends it server-side to prism-gateway
  -> prism-gateway encrypts it on its mounted volume
  -> codex-runtime invokes the named capability without receiving the credential
  -> prism-gateway records the policy decision, result status, and usage
```

The capability and connection are instance-owned. The template supplies the
constrained connector driver and policy machinery, not a Plausible account, a
RaidGuild CRM schema, or any other organization-specific integration.

## Easy Mode Contract

Gateway internals must not become routine configuration overhead. The default
operator flow is:

1. an admin asks Prism chat to configure an integration
2. the `prism-gateway-author` skill creates pending non-secret configuration
3. chat directs the admin to a connection-specific Settings URL to enter the
   credential outside model context
4. chat tests and enables the integration after the admin confirms
5. the default runtime grant is created automatically
6. Site admin Console sessions receive all enabled capabilities
7. Discord and Telegram sessions inherit capabilities from the existing source
   adapter target, group, and user policy
8. workflows may declare narrower or additional requirements without being the
   only way to use an integration

`readonly` and `run-approved` interactive sessions receive enabled read
capabilities. `full` sessions receive all enabled capabilities and behave like
an admin Console session, subject to normal approval and audit controls. A user
rule may still reduce access granted by a channel or role rule.

Connection records, capability keys, runtime grants, drivers, and schemas are
advanced configuration. Provider presets should hide those concepts for common
integrations. Gateway catalog failure must not disable legacy direct tools while
the migration is additive.

Credentials are the exception to conversational configuration. Agent routes
must reject credential values. Secret create, replace, and revoke use the
existing Site admin session and Settings UI, with chat returning a stable deep
link to the relevant connection.

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
- Seed fixed connector drivers and optional capability presets. MVP admins may
  create declarative capabilities bound to approved drivers, but may not upload
  arbitrary executable capability code.
- Require an idempotency key for delivery, write, and destructive capabilities.
- A compatibility fallback may handle a disabled integration or an unavailable
  legacy route. It must never bypass gateway authentication, policy, approval,
  budget, or destination denials.
- Use AES-256-GCM with a versioned key reference, nonce, authentication tag, and
  authenticated connection metadata.
- Keep budgets in warning mode and defer payment settlement.
- Preserve current Codex Runtime routes while adding the shared runtime adapter
  contract.

## First Connector And Capabilities

Start with one constrained read connector and one instance capability. Add a
delivery capability after the read vertical slice is stable.

### Read Connector

Locked first connector driver:

```text
http-json.read
```

Why:

- supports instance-specific read APIs without teaching the template about each
  organization
- can require a fixed HTTPS base URL, fixed method and path template, bounded
  response size, timeout, redaction, and input/output schemas
- keeps provider credentials out of runtime context
- can support analytics or narrow CRM reads through named capabilities

Example instance capabilities:

```text
analytics.query
crm.contact.read
plausible.query
```

An invocation cannot supply a base URL, arbitrary path, method, or authentication
header. Those are admin-owned capability configuration. The driver must reject
private, loopback, link-local, and metadata-service destinations unless a future
internal-service driver explicitly allows them.

Optional capability presets may make common providers easier to configure, but
presets are disabled until an instance creates a connection.

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

MVP seeds approved connector drivers and optional presets. Admins can create a
declarative instance capability bound to an approved driver and connection.
User-uploaded executable capability code can come later, if ever.

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
  "capability": "analytics.query",
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
  "capability": "analytics.query",
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
connector_drivers
  key text primary key
  mode text not null
  description text not null
  built_in integer not null default 1
  created_at text not null
  updated_at text not null

capabilities
  key text primary key
  driver_key text not null
  connection_id text
  provider text not null
  mode text not null
  description text not null
  driver_config_json text not null
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
  auth_tag text not null
  key_version text not null
  associated_data_json text not null
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

Recommended first connector to prove:

```text
http-json.read
```

Reason:

- read-only and bounded
- useful with several instance-specific APIs
- proves secure connection storage without making a provider part of Prism core
- easier to validate than write APIs

For the `prism-stack` pilot, configure one low-risk instance capability through
the UI. Plausible analytics is a good option if the operator supplies that
connection; otherwise use a narrowly scoped CRM read. After proving connection
storage and invocation, migrate one existing read-oriented credential from
Codex Runtime. Do not choose a private key, social publishing credential, or
broad object storage credential for the first migration.

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
- [x] Lock the first connector and follow-up delivery capability.
- [x] Decide service name and Railway volume mount.
- [x] Add migration, environment delta, rollback, and production preflight docs.

### Phase 1: Service Skeleton

- [x] Add `services/prism-gateway`.
- [x] Add health endpoint.
- [x] Add SQLite migration runner.
- [x] Add `/data` volume expectation.
- [x] Add caller-specific service-token auth middleware.
- [x] Add `.env.example` and template variable references.

### Phase 2: Capability Catalog And Connections

- [x] Seed the approved `http-json.read` connector driver.
- [x] Add declarative instance capability create.
- [x] Add declarative instance capability enable/disable.
- [ ] Add declarative instance capability configuration update.
- [x] Add connection create/list/replace/revoke.
- [x] Add capability test through the configured connection.
- [x] Keep encrypted secret rows internal and redact admin responses.
- [x] Add integration connection records.
- [x] Add admin-safe response redaction.

### Phase 3: Invoke And Audit

- [x] Add `POST /invoke`.
- [x] Add default-deny caller grant policy checks.
- [x] Add audit event writes and read routes.
- [x] Add warning-only usage ledger writes.
- [x] Add timeout handling for downstream calls.

### Phase 4: First Capabilities

- [x] Execute the constrained `http-json.read` driver through `/invoke`.
- [x] Configure one instance-owned read capability on `prism-stack`.
- [ ] Implement `comms.discord.send_message`.
- [x] Add capability-specific query allowlisting and credential mapping.
- [x] Add DNS pinning, private-address rejection, no redirects, and response limits.
- [x] Add capability-specific output normalization.
- [x] Add a constrained MCP read driver with fixed operation-to-tool mappings.
- [ ] Migrate the existing NextCRM contact-read credential from Codex Runtime.

### Phase 5: Site Admin UI

- [x] Add Settings -> Gateway.
- [x] Show gateway health.
- [x] Show capabilities.
- [x] Add/test/delete integration secret.
- [x] Manage runtime and service grants.
- [x] Show audit events.
- [ ] Show usage warnings.

### Phase 6: Runtime Client

- [x] Add gateway client helper.
- [x] Wire one runtime/tool path through the gateway.
- [x] Give admin Console sessions enabled capabilities by default.
- [x] Map Discord and Telegram source policy to interactive capabilities.
- [x] Auto-grant newly created capabilities to the default runtime.
- [x] Preserve direct-tool chat behavior when Gateway catalog lookup fails.
- [x] Add chat-safe Gateway authoring routes and a built-in authoring skill.
- [x] Add connection-specific Settings credential deep links.
- [x] Add an idempotent Plausible integration preset endpoint.
- [x] Remove one duplicated integration secret from Codex Runtime after
  capability-backed skill validation (`ARCADE_AGENT_API_KEY` on `prism-stack`).
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

1. Should the `prism-stack` pilot use Plausible analytics or a sufficiently
   narrow CRM read as its first instance capability?
2. Should request-linked audit summaries later be copied into Site artifacts?
3. Should gateway tools gain an MCP surface after the HTTP invocation API is
   stable?
4. Which second runtime is useful enough to validate adapter portability?
5. When should warning-only budgets become enforceable limits?
