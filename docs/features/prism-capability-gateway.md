# Prism Capability Gateway

Status: future feature spec

Implementation follow-up: [Prism Gateway MVP Implementation Plan](./prism-gateway-mvp-implementation-plan.md)

Runtime boundary: [Prism Runtime Adapter Contract](../architecture/runtime-adapter-contract.md)

## Purpose

Prism instances are accumulating more connected systems:

- Prism site/API
- Prism Memory
- communication adapter
- source adapter
- portal
- CRM
- Plausible
- DAOhaus graph
- GitHub
- object storage
- X
- LLM providers
- render services
- external MCP/API tools

Today many of these credentials and URLs are carried directly by Codex Runtime,
task-runner, or service-specific environments. That works for a small trusted
stack, but it becomes harder to manage as Prism adds specialized agents, multiple
runtime types, external tool consumers, and cross-instance workflows.

Add an optional `prism-gateway` service that becomes the organization-level
capability boundary for agent, workflow, model, tool, data, and delivery access.

The primary outcomes are:

1. Codex Runtime becomes one replaceable runtime adapter rather than the place
   where organization skills, tools, and integration credentials accumulate.
2. Prism-managed skills remain owned by Site and are available consistently to
   Codex and future runtimes.
3. Organization integrations become named capabilities whose credentials are
   not exposed to runtimes.
4. Authorized Prism admins can add, test, replace, and revoke integration
   credentials through the Site UI without Railway environment access.
5. Railway variables are reduced to bootstrap encryption, service identity,
   runtime authentication, and infrastructure configuration.

## Core Idea

Runtimes should not own every integration secret or decide every access rule.
They should execute work as an identified actor and ask the gateway for scoped
capabilities.

```text
codex-runtime / task-runner / external agent / console
        |
        v
prism-gateway
        |
        +-- site/api
        +-- prism-memory
        +-- communication-adapter
        +-- source-adapter
        +-- CRM / portal / Plausible
        +-- GitHub / X / storage / LLMs / render services
        +-- MCP servers and external APIs
```

The gateway should manage capabilities, not just raw secrets.

```text
Weak abstraction:
  getSecret("GITHUB_TOKEN")

Preferred abstraction:
  invoke("github.create_pr", input, context)
```

The agent or runtime should normally receive the result of an allowed action,
not the secret used to perform it.

## Template And Instance Ownership

The Railway template should not assume that every Prism organization uses
Plausible, a particular CRM, Portal, X, or any other provider.

Template-owned Gateway resources:

- constrained connector drivers such as `http-json.read`
- optional disabled presets for common providers
- encryption, authentication, policy, audit, and usage machinery
- Site UI and service-to-service contracts

Instance-owned Gateway resources:

- integration connections and encrypted credentials
- capability names and declarative input/output schemas
- bindings between capabilities, connections, and approved drivers
- actor, role, runtime, destination, and budget grants

Runtime-visible resources:

- stable capability names such as `analytics.query` or `crm.contact.read`
- input and output schemas
- invocation results and trace IDs

An instance admin may configure a declarative capability through an approved
driver. The MVP does not allow arbitrary uploaded executable code. For a generic
HTTP read driver, base URL, method, path template, authentication, timeout,
response limit, and redaction are admin-owned configuration and cannot be
overridden by an invocation.

## Responsibility Split

### Prism Site/API

Owns Prism application state:

- requests
- workflows
- tasks
- skills
- hooks
- artifacts
- approvals
- admin UI
- agent API routes
- branding and workspace configuration

The site service may expose the UI for gateway configuration, but it should not
become the general proxy for every external tool.

### Prism Gateway

Owns capability enforcement:

- capability catalog
- actor profiles
- policy checks
- integration secret references
- encrypted integration secrets for the MVP
- tool invocation/proxy routes
- audit events
- usage ledger and budgets
- model/tool/data routing rules
- approval checks for high-risk capabilities

### Runtime Services

Codex Runtime, task-runner, and future specialized runtimes execute work. They
identify the actor, workflow, request, and runtime context, then call the gateway
for tools or data.

Codex Runtime remains useful for repository-aware coding, shell work, Prism ops,
and artifact generation, but it should become one runtime among several rather
than the holder of all organizational authority.

Runtime services implement a common job contract for submit, status,
cancellation, capabilities, normalized output, artifacts, usage, and errors.
The existing `codex-runtime` service becomes the Codex adapter directly; Prism
does not add another proxy service in front of it.

### Domain Adapters

Adapters keep platform-specific behavior:

- `communication-adapter` owns Discord, Telegram, and SendGrid protocol details.
- `source-adapter` owns source ingestion details.
- Prism Memory owns memory indexing, retrieval, digests, and memory ops.

The gateway sits in front of adapters for authorized capability use. It does not
need to replace them.

## Railway Template Placement

Add a new service beside the existing services:

```text
site
task-runner
codex-runtime
prism-memory
communication-adapter
source-adapter
prism-gateway
```

Target connection pattern:

```text
codex-runtime -> prism-gateway -> selected capabilities
task-runner   -> prism-gateway -> selected capabilities
site          -> prism-gateway -> admin/config/test actions

prism-gateway -> site
prism-gateway -> prism-memory
prism-gateway -> communication-adapter
prism-gateway -> source-adapter
prism-gateway -> external APIs
```

Existing direct internal calls do not need to disappear immediately. Prism-native
control traffic can remain direct where that is simpler:

```text
task-runner <-> site
codex-runtime <-> site
site <-> prism-memory
source-adapter <-> prism-memory
```

Capability/tool traffic should migrate to the gateway over time:

```text
send a message
query CRM
read Plausible
publish to X
create GitHub PR
call paid data snapshot
invoke external MCP tool
call LLM provider
render media
```

## MVP Storage Pattern

Follow the current template style: a mounted Railway volume plus SQLite.

```text
prism-gateway
  volume: /data
  sqlite: /data/prism-gateway.sqlite
```

Railway variables should hold only bootstrap and infra secrets:

```env
GATEWAY_MASTER_ENCRYPTION_KEY=
GATEWAY_SITE_TOKEN=
GATEWAY_CODEX_RUNTIME_TOKEN=
GATEWAY_TASK_RUNNER_TOKEN=
SITE_INTERNAL_URL=
SITE_INTERNAL_TOKEN=
MEMORY_INTERNAL_URL=
MEMORY_INTERNAL_TOKEN=
COMMS_INTERNAL_URL=
COMMS_INTERNAL_TOKEN=
SOURCE_ADAPTER_INTERNAL_URL=
SOURCE_ADAPTER_INTERNAL_TOKEN=
```

Gateway-managed integration credentials should be encrypted before writing to
SQLite. The root encryption key stays in Railway.

Suggested tables:

```text
connector_drivers
capabilities
actor_profiles
profile_capabilities
integration_connections
encrypted_secrets
audit_events
usage_ledger
budget_limits
```

SQLite is appropriate for one gateway instance. Do not horizontally scale the
gateway against the same mounted SQLite database without revisiting storage and
write contention.

## Capability Model

Capabilities are the common language between Prism, runtimes, users, agents, and
external tools.

Examples:

```text
memory.search
memory.snapshot
comms.discord.send_message
comms.telegram.send_message
comms.email.send
crm.contact.read
crm.contact.update
plausible.query
github.repo.read
github.pr.create
x.post.draft
x.post.publish
storage.artifact.write
remotion.render
model.generate
```

These names are examples, not capabilities that every template deployment must
enable. The template may ship optional presets, while each instance chooses its
actual catalog.

Suggested capability metadata:

```text
key
driver_key
connection_id
provider
description
driver_config_json
input_schema_json
output_schema_json
risk_level
mode
requires_approval
default_audit_level
default_unit_price
created_at
updated_at
```

`mode` should use a controlled vocabulary such as:

- `read`
- `write`
- `delivery`
- `destructive`
- `model`
- `runtime`

## Actor Context

Every invocation should carry enough context to explain who acted and why.

```json
{
  "actor": "growth-agent",
  "runtime": "codex-runtime",
  "initiatedBy": "user:123",
  "org": "raidguild",
  "requestId": "43",
  "workflowRunId": "wf_run_abc",
  "workflowStepKey": "draft",
  "capability": "plausible.query"
}
```

The policy engine should distinguish:

- human user
- agent identity
- runtime identity
- workflow identity
- request/change-board identity
- org/workspace identity
- delegation chain

Authenticated caller identity must come from the gateway credential, not these
JSON fields. Each calling service receives a distinct gateway token mapped to a
trusted caller or runtime identity. Actor and workflow fields are delegated
context and cannot override the authenticated caller.

## Policy Layers

The gateway should evaluate separate questions explicitly:

```text
Identity:
  Who is acting, on whose behalf, from which runtime/workflow/org?

Policy:
  Is this actor allowed to use this capability with this data?

Approval:
  Has the relevant request/workflow gate approved this action?

Budget:
  Does this actor/request/org have enough remaining budget?

Routing:
  Which provider, adapter, model, runtime, or MCP server should handle it?

Audit:
  What should be logged, redacted, attached, or written to memory?
```

Do not collapse RBAC, approvals, budgets, and payment into one check. They answer
different questions and should be observable independently.

## Secrets UI

The gateway should eventually let org admins connect integrations without
Railway access.

Initial interface:

- create integration secret
- validate/test integration secret
- rotate integration secret
- revoke integration secret
- assign secret to capabilities
- show last-used timestamp
- show audit events
- hide secret value after creation

The browser uses the existing Site admin session. Site calls Gateway
server-side; gateway service credentials are never exposed to browser code.

Example connection records:

```text
github.main
  provider: github
  auth_type: token
  capabilities:
    - github.repo.read
    - github.pr.create

plausible.default
  provider: plausible
  auth_type: api_key
  capabilities:
    - plausible.query

comms.discord.bot
  provider: discord
  auth_type: bot_token
  capabilities:
    - comms.discord.send_message
    - comms.discord.list_channels
```

For the MVP, Discord, Telegram, and SendGrid secrets can remain in the
communication adapter environment. The gateway can call the adapter through a
scoped internal token. Later, those credentials can move into gateway-managed
secrets if org admins need to connect or rotate them without Railway access.

## Comms Adapter Example

Do not replace the communication adapter with the gateway. Put the gateway in
front of it.

```text
Agent / workflow / console
        |
        v
prism-gateway
        |
        v
communication-adapter
        |
        +-- Discord
        +-- Telegram
        +-- SendGrid
```

The gateway decides:

- is this actor allowed to send?
- to which destination?
- as which org/workspace?
- does this require approval?
- should the payload be logged, redacted, or blocked?
- what rate limit or budget applies?

The communication adapter handles:

- platform auth
- destination resolution
- platform formatting
- webhook/event handling
- actual delivery

## Usage Ledger And Internal Pricing

The gateway can support the experimental x402/MPP direction without coupling the
internal stack to payments too early.

Start with a shadow ledger:

```text
actor_id
user_id
org_id
request_id
workflow_id
capability_key
provider
units
unit_price
estimated_cost
actual_cost
settlement_status
trace_id
created_at
```

Use internal prices for analytics, budgets, and observability:

```text
memory.search.basic
plausible.query
crm.read_contact
github.pr.create
remotion.render
model.generate
comms.email.send_external
x.post.publish
```

Later, x402 or Machine Payments Protocol can be added at the edge:

- external agents paying to use Prism capabilities
- Prism agents consuming paid external tools
- cross-org tool usage
- paid data snapshots
- marketplace-style capability exposure

## Observability

Every gateway invocation should emit an audit event with a stable trace ID.

Capture:

- actor
- runtime
- request/workflow/task context
- capability key
- provider
- approval state
- budget decision
- latency
- success/failure
- estimated and actual cost
- redacted input/output summary
- artifact or memory refs when relevant

Events should be queryable from the gateway and may be forwarded into Prism site
or Prism Memory for request review, usage analytics, and long-term operational
memory.

## Future Backends

### Vault

HashiCorp Vault or HCP Vault can become a secret backend later.

```text
prism-gateway -> Vault -> secrets
```

Vault should not replace the gateway. It only strengthens secret storage,
rotation, and secret-access audit. The gateway still owns Prism-aware policy,
approval, actor context, capability schemas, and tool invocation.

The gateway should define a pluggable secret backend interface:

```text
railway-env
encrypted-sqlite
vault
hcp-vault
```

### agentgateway

agentgateway can become a protocol/data-plane layer later, especially for:

- MCP aggregation and filtering
- A2A routing
- LLM provider routing
- HTTP/gRPC gateway behavior
- lower-level traffic governance

Prism Gateway should remain the Prism-aware control layer unless the external
gateway can enforce Prism-specific concepts such as request approvals, workflow
steps, artifact links, and Prism Memory policies.

### Composio

Composio can be used behind the gateway for managed SaaS integrations and OAuth
flows.

```text
prism-gateway -> Composio -> third-party SaaS
```

Prism should still own actors, approvals, budgets, audit, and request/workflow
context.

## Migration Plan

This should be an additive feature, not a template rewrite.

1. Add `prism-gateway` as an optional Railway service with volume-backed SQLite.
2. Add `PRISM_GATEWAY_BASE_URL` and `PRISM_GATEWAY_TOKEN` to Codex Runtime and
   task-runner.
3. Implement basic routes:
   - `GET /health`
   - `GET /capabilities`
   - `POST /invoke`
   - `GET /connections`
   - `POST /connections`
   - `POST /connections/:id/test`
   - `PUT /connections/:id/credentials`
   - `DELETE /connections/:id`
   - `GET /grants`
   - `PUT /grants/:id`
   - `GET /audit-events`
4. Proxy one low-risk read capability, such as `plausible.query` or
   `memory.search`.
5. Proxy one write or delivery capability, such as
   `comms.discord.send_message`.
6. Emit audit events into the gateway database.
7. Move selected integration secrets out of Codex Runtime and into gateway
   encrypted storage.
8. Add warning-only usage ledger and budgets.
9. Add Prism admin UI for capability and secret management.
10. Evaluate Vault, agentgateway, Composio, x402, and MPP as optional backends or
    edge protocols.

For existing Railway instances, ship an environment delta, idempotent setup
script, smoke checks, and rollback procedure. Service reference variables should
wire internal URLs and caller-specific gateway tokens so operators do not copy
the same values into each service manually.

## Non-Goals For The First Version

- Replace Prism site/API.
- Replace Prism Memory.
- Replace communication adapter or source adapter.
- Move all secrets out of Railway immediately.
- Require Vault, HCP Vault, Composio, agentgateway, x402, or MPP.
- Force all existing internal service calls through the gateway.
- Add multi-tenant SaaS complexity before the single-instance template proves
  the boundary useful.

## Open Questions

- Should the first gateway API be generic `POST /invoke`, provider-specific
  routes, or both?
- Should gateway audit events be copied into site artifacts, Prism Memory, or
  both?
- Which capabilities should ship as defaults in the template?
- How should approval checks read workflow/request state from site/API?
- How much of the management UI belongs in site admin versus the gateway itself?
- Should external agents access the gateway directly or only through site/API
  mediated sessions?
- What is the first paid capability experiment for the x402/MPP direction?
