# Prism Runtime Adapter Contract

Status: implementation in progress

Related plan: [Prism Gateway MVP Implementation Plan](../features/prism-gateway-mvp-implementation-plan.md)

Related feature: [Local Prism Stack And Runtime Bridge](../features/local-prism-stack-and-runtime-bridge.md)

## Purpose

Make Codex Runtime one replaceable execution adapter instead of a hard-coded
Prism dependency. Prism should submit and observe runtime jobs through one
contract while each adapter translates those jobs into its own CLI, API, or
agent harness.

The contract is intentionally close to the existing Codex Runtime job API. The
first implementation should normalize existing behavior, not build a plugin
framework for runtimes that do not yet exist.

## Service Boundary

```text
site / task-runner / source-adapter
        |
        v
Prism runtime job contract
        |
        +-- codex-runtime -> Codex CLI
        +-- future runtime -> another CLI, API, or harness
```

Each long-running runtime adapter is normally its own Railway service. There is
no additional proxy service in front of `codex-runtime`. The existing service
becomes the Codex implementation of this contract.

Site owns runtime profile configuration and chooses the runtime for a workflow,
task, or console session. The capability gateway does not own runtime job
scheduling.

## Version

The initial contract version is:

```text
2026-07-10
```

Shared TypeScript types live in `packages/contracts/src/index.ts`.

### Current Adapter Discovery

Codex Runtime exposes an additive discovery manifest:

```text
GET /v1/runtime/manifest
```

The manifest reports runtime identity, contract version, compatibility endpoint
paths, normalized job endpoints, and features that are actually implemented.
Codex Runtime supports the normalized routes below, including cancellation,
while retaining `/v1/responses/jobs` for callers that have not migrated yet.

## Required Routes

```text
GET  /health
GET  /v1/runtime/capabilities
POST /v1/runtime/jobs
GET  /v1/runtime/jobs/:jobId
POST /v1/runtime/jobs/:jobId/cancel
```

The first Codex implementation may keep these compatibility routes while
callers migrate:

```text
POST /v1/responses
POST /v1/responses/jobs
GET  /v1/responses/jobs/:jobId
```

## Submit Job

```json
{
  "contractVersion": "2026-07-10",
  "prompt": "Prepare the weekly analytics brief.",
  "sessionId": "request:344:step:synthesize",
  "continuationId": null,
  "recentHistory": [],
  "skills": [
    {
      "name": "weekly-analytics-brief",
      "contentUrl": "http://site.railway.internal:3100/agent/skills/weekly-analytics-brief"
    }
  ],
  "toolsets": [
    {
      "key": "portal.admin",
      "protocol": "openapi"
    }
  ],
  "context": {
    "delegatedActorId": "content-agent",
    "initiatedBy": "user:123",
    "orgId": "raidguild",
    "requestId": "344",
    "workflowRunId": "wf_run_abc",
    "workflowStepKey": "synthesize"
  },
  "metadata": {}
}
```

The adapter must not treat `delegatedActorId` or `initiatedBy` as authenticated
runtime identity. Service authentication establishes the adapter caller. The
delegation context explains on whose behalf the job is running.

## Job Response

```json
{
  "id": "runtime_job_01",
  "runtimeKey": "codex-default",
  "adapter": "codex",
  "status": "succeeded",
  "createdAt": "2026-07-10T16:00:00.000Z",
  "startedAt": "2026-07-10T16:00:01.000Z",
  "finishedAt": "2026-07-10T16:02:10.000Z",
  "result": {
    "responseText": "The weekly brief is ready.",
    "continuationId": "codex_thread_abc",
    "artifacts": [],
    "usage": {
      "inputTokens": 1200,
      "outputTokens": 400,
      "estimatedCost": 0.08,
      "currency": "USD"
    }
  },
  "error": null,
  "trace": []
}
```

Controlled statuses:

```text
queued
running
succeeded
failed
canceled
```

Errors must include a stable code, a safe message, and whether retry is
appropriate. Provider-specific failures may be retained in redacted metadata,
but callers should not need to parse Codex-specific strings.

## Runtime Features And Organization Toolsets

`GET /v1/runtime/capabilities` describes execution features, not organizational
tool permissions.

Examples:

```text
repository
shell
site-hosted-skills
continuations
image-input
gateway-toolsets
```

The runtime request lists the Gateway toolset profiles assigned to that job.
Site resolves those assignments from Console context, source-adapter policy,
runtime profile, workflow, task, and selected skills. Gateway verifies the
short-lived session assignment and brokers the associated credential.

The downstream service remains authoritative for the credential's RBAC and
request validation. Runtime adapters must not receive the long-lived provider
credential.

During migration, adapters may continue to accept the existing `capabilities`
array for narrow compatibility wrappers. New broad integrations should use
`toolsets`.

## Skills And Tools

Site is the source of truth for Prism-managed skills. Runtime adapters fetch
requested skills from authenticated Site agent routes or receive stable skill
references. Skills should not be copied into runtime-specific persistent
storage as the canonical version.

Gateway is the source of truth for credential-backed organization toolset
profiles. Runtime adapters receive discovered OpenAPI/MCP tools or fixed-origin
HTTP access for assigned profiles, not underlying provider credentials.

Gateway toolsets bind credentials to a configured origin; they do not restrict
an assigned agent to a Gateway-owned operation catalog. Method, path, query, and
body selection remain runtime concerns, subject to the downstream identity's
actual permissions.

Generic skills remain runtime- and credential-provider agnostic. Site assigns
enabled toolsets to Admin Console and full-access source contexts through its
existing policy. Instance-owned deterministic workflows may declare
`metadata.gateway-toolsets`; existing `metadata.gateway-capabilities`
declarations remain valid for narrow wrappers.

Runtime-specific system instructions and bootstrap authentication may remain
inside the runtime service. For example, Codex CLI device authentication can
remain on the Codex Runtime volume.

## Cancellation

`POST /v1/runtime/jobs/:jobId/cancel` is idempotent. It should request
cancellation from the underlying runtime and return the latest normalized job.
Late runtime completion must not overwrite a canceled Site agent run.

## Runtime Profiles

Site stores profiles shaped like:

```json
{
  "key": "codex-default",
  "adapter": "codex",
  "baseUrl": "http://codex-runtime.railway.internal:3030",
  "enabled": true,
  "features": ["repository", "shell", "site-hosted-skills", "gateway-toolsets"]
}
```

The profile stores routing and feature metadata in Site SQLite. On migration,
Site bootstraps `codex-default` from `CODEX_RUNTIME_BASE_URL` only when no
profiles exist; subsequent profile configuration is database-owned. Service
tokens remain bootstrap variables and are never returned to the browser.

## Migration Rules

1. Add shared client and response normalization without changing existing Codex
   behavior.
2. Add the new routes to `codex-runtime` while retaining compatibility routes.
3. Move one caller at a time to runtime profiles.
4. Do not add a second runtime until the Codex path is stable through the common
   contract.
5. A fallback may handle an unavailable compatibility route during migration.
   It must not retry around authentication, policy, or cancellation decisions.

## First Proof

The contract is proven when the same Site-owned job envelope can be accepted by
Codex Runtime and a minimal second adapter without Site changing its workflow or
skill model. Building the second adapter is not part of the gateway MVP.
