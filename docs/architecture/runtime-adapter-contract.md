# Prism Runtime Adapter Contract

Status: pre-implementation contract

Related plan: [Prism Gateway MVP Implementation Plan](../features/prism-gateway-mvp-implementation-plan.md)

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
  "capabilities": [
    {
      "key": "plausible.query",
      "grantId": "grant_analytics_read"
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

## Capabilities

`GET /v1/runtime/capabilities` describes execution features, not organizational
tool permissions.

Examples:

```text
repository
shell
site-hosted-skills
continuations
image-input
gateway-capabilities
```

The runtime request lists the gateway capabilities granted for that job. The
runtime still invokes the gateway, which makes the authoritative policy
decision. A capability listed in the job is not permission by itself.

## Skills And Tools

Site is the source of truth for Prism-managed skills. Runtime adapters fetch
requested skills from authenticated Site agent routes or receive stable skill
references. Skills should not be copied into runtime-specific persistent
storage as the canonical version.

The gateway is the source of truth for organization integration capabilities.
Runtime adapters should receive capability names and invocation access, not the
underlying provider credentials.

Runtime-specific system instructions and bootstrap authentication may remain
inside the runtime service. For example, Codex CLI device authentication can
remain on the Codex Runtime volume.

## Cancellation

`POST /v1/runtime/jobs/:jobId/cancel` is idempotent. It should request
cancellation from the underlying runtime and return the latest normalized job.
Late runtime completion must not overwrite a canceled Site agent run.

## Runtime Profiles

Site should eventually store profiles shaped like:

```json
{
  "key": "codex-default",
  "adapter": "codex",
  "baseUrl": "http://codex-runtime.railway.internal:3030",
  "enabled": true,
  "features": ["repository", "shell", "site-hosted-skills", "gateway-capabilities"]
}
```

The profile stores routing and feature metadata. Service tokens remain Railway
bootstrap variables and are never returned to the browser.

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
