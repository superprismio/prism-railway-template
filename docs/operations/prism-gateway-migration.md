# Prism Gateway Migration

Status: pre-implementation runbook

Related plan: [Prism Gateway MVP Implementation Plan](../features/prism-gateway-mvp-implementation-plan.md)

Use this runbook for both the production pilot on an existing Prism instance and
the later Railway template update. The migration is additive until one
integration has been proven through Gateway and deliberately removed from its
old runtime environment.

## Safety Rules

- Confirm the linked Railway project and environment before every mutation.
- Never print Railway variable values while inventorying an instance.
- Deploy Gateway disabled at callers first.
- Use a different gateway token for each calling service.
- Do not expose gateway tokens or provider credentials to browser code.
- Do not fall back after authentication, policy, approval, budget, or
  destination denial.
- Keep the old direct integration configured until the gateway path passes its
  smoke test, then remove it in a separate change.
- Back up the Site volume before applying a Site database migration.

## Read-Only Preflight

From a checkout linked to the target Railway project:

```bash
bash scripts/railway-prism-gateway-preflight.sh
```

The script reports service wiring and relevant variable names only. It must not
print values.

For the first production pilot, confirm:

- `site`, `codex-runtime`, `task-runner`, `communication-adapter`, and
  `prism-memory` are healthy
- the working branch contains current `origin/main`
- existing callers still have their current Codex Runtime URL
- no `prism-gateway` service or gateway variables already exist unexpectedly
- `/data` volume creation is available for the new service

## Environment Delta

### New `prism-gateway` Service

| Variable | Source | Required for first slice | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | literal `production` | yes | Runtime mode. |
| `PORT` | literal `8794` | yes | Internal service port. |
| `GATEWAY_MASTER_ENCRYPTION_KEY` | generated secret | yes | Root key remains in Railway. Never expose through Site. |
| `GATEWAY_SITE_TOKEN` | generated secret | yes | Authenticates server-side Site calls. |
| `GATEWAY_CODEX_RUNTIME_TOKEN` | generated secret | yes | Authenticates Codex Runtime capability calls. |
| `GATEWAY_TASK_RUNNER_TOKEN` | generated secret | later | Add when task-runner invokes capabilities directly. |
| `SITE_INTERNAL_URL` | Railway service reference | later | Needed when Gateway verifies Site-owned approvals or identity state. |
| `SITE_INTERNAL_TOKEN` | Railway service reference | later | Scoped Site agent token. |

Attach one volume:

```text
service: prism-gateway
mount: /data
database: /data/prism-gateway.sqlite
```

### `site`

| Variable | Source | Initial value |
| --- | --- | --- |
| `PRISM_GATEWAY_ENABLED` | literal | `false` |
| `PRISM_GATEWAY_BASE_URL` | `http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}` | service reference |
| `PRISM_GATEWAY_TOKEN` | `${{prism-gateway.GATEWAY_SITE_TOKEN}}` | service reference |

The Site UI should hide Gateway configuration when the feature is disabled or
the health check is unavailable. Enabling the feature must not affect existing
request, workflow, skill, or capture routes.

### `codex-runtime`

| Variable | Source | Initial value |
| --- | --- | --- |
| `PRISM_GATEWAY_ENABLED` | literal | `false` |
| `PRISM_GATEWAY_BASE_URL` | `http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}` | service reference |
| `PRISM_GATEWAY_TOKEN` | `${{prism-gateway.GATEWAY_CODEX_RUNTIME_TOKEN}}` | service reference |
| `PRISM_RUNTIME_KEY` | literal | `codex-default` |

Codex CLI device authentication and `CODEX_HOME` stay on the Codex Runtime
volume. They identify and configure the runtime itself, not an organization
integration capability.

### `task-runner`

No Gateway variables are required in the first vertical slice. Task Runner
continues to submit runtime jobs. Add its caller-specific Gateway variables only
when a task needs to invoke Gateway without a runtime.

### Other Services

`communication-adapter`, `source-adapter`, and `prism-memory` require no Gateway
variables for the first slice. Their existing behavior remains unchanged.

## Production Baseline

The read-only inventory of `prism-stack` on 2026-07-10 found:

- five active services: Site, Codex Runtime, Task Runner, communication adapter,
  and Prism Memory
- persistent `/data` volumes on Site, Codex Runtime, communication adapter, and
  Prism Memory
- direct Codex Runtime callers in Site, Task Runner, and communication adapter
- Site-owned skill routes already used by runtime flows
- organization integration credentials concentrated in Codex Runtime across
  model, social publishing, CRM, CMS, object storage, repository, wallet, and
  external-agent categories
- transcription credentials also present in services that perform local media
  transcription
- no Plausible credential on the active production services

The provisional first removal candidate is a narrow `crm.contact.read`
capability backed by the existing CRM connection. Verify the provider endpoint
and token scope before migration; do not expose a broad MCP credential to the
Gateway merely to satisfy this milestone.

No variable values were read into this document. Run the preflight again before
implementation because Railway state may change.

## Working Branch Pilot

Use one implementation branch based on current `origin/main`. Railway can point
individual services at that branch, so rollout does not require changing all
services at once.

Recommended order:

1. Create `prism-gateway` from the working branch and attach `/data`.
2. Set generated Gateway bootstrap secrets and deploy it.
3. Test health, database migration, restart persistence, and caller-token
   separation directly.
4. Point only Site at the working branch with Gateway disabled.
5. Enable Site Gateway settings and add/test one read-only instance connection.
6. Point only Codex Runtime at the working branch with Gateway disabled.
7. Enable Gateway for one Codex runtime profile or actor grant.
8. Invoke its instance-owned capability and verify the result, trace ID, audit
   event, and warning-only usage row.
9. Restart and redeploy Gateway, then repeat the invocation to prove encrypted
   connection persistence.
10. Select one existing read-oriented integration for actual credential
    migration. Remove its old runtime variable only after a separate smoke test.

Do not point Task Runner or communication adapter at the branch merely because
the branch exists. Change them only when their code or configuration is part of
the tested slice.

## Smoke Checks

The first pilot must demonstrate:

- Gateway refuses missing and invalid caller tokens.
- Site token cannot impersonate Codex Runtime.
- Request JSON cannot override authenticated caller identity.
- Secret create responses never return plaintext.
- Secret values are absent from logs, audit input/output summaries, and errors.
- A valid instance-owned read capability succeeds with a stable trace ID.
- A denied capability creates a denial audit event and does not call the
  provider.
- A Gateway restart preserves the encrypted connection and audit history.
- Replacing or revoking the connection takes effect immediately.
- Disabling Gateway restores the explicitly configured compatibility path.
- A policy denial never falls through to direct provider access.

## Existing Credential Migration

Move credentials one at a time:

1. Inventory the skills, workflows, tasks, hooks, and console use that depend on
   the credential. Do not infer this only from Railway variable names.
2. Create a Gateway connection through Site Settings.
3. Create and test the required read/write capabilities without changing
   runtime behavior.
4. Declare those keys once in each integration skill's `SKILL.md` frontmatter
   under `gateway-capabilities`.
5. Ensure workflow steps reference the skill through `agentConfig.skills` and
   tasks request it through `instructionConfig.requestedSkills`. Do not copy the
   capability list into every workflow, task, or hook.
6. Use `agentConfig.gatewayCapabilities` only for direct Gateway calls made by
   a workflow step that has no capability-declaring skill.
7. Add the corresponding capability grant to the runtime profile or actor.
8. Deploy Site, Codex Runtime, and Task Runner with capability-aware Doctor
   checks before changing any legacy environment variable.
9. Run Prism Doctor. Repair missing skill references and missing or disabled
   capabilities before proceeding.
10. Exercise console use plus every enabled workflow, task, and hook identified
    in the inventory. Compare normalized output with the old path.
11. Confirm audit, latency, and usage records for each execution path.
12. Disable direct fallback for that capability.
13. Delete the old Railway variable from the runtime service, redeploy, and
    repeat Doctor and the execution matrix.
14. Document the migrated variable and tested callers in the instance's
    environment delta history.

The capability declaration is a dependency, not an authorization grant. Codex
Runtime adds skill requirements to a short-lived job capability session;
Gateway still enforces runtime, actor, risk, and capability policy. This keeps
existing skills and workflows portable between runtimes while allowing each
instance to configure different providers and grants.

### Instance Upgrade Checklist

Apply this checklist to existing instances when the capability-aware runtime is
introduced:

- deploy the new Site and Codex Runtime while all legacy secrets remain present
- deploy the updated Task Runner so Prism Doctor understands skill dependencies
- run Doctor once before editing instance content and retain the report
- add `gateway-capabilities` to custom and source-backed integration skills
- repair only true missing skill references or unavailable capabilities; do not
  add duplicate capability arrays to every workflow
- test direct console use, scheduled tasks, hooks, and representative workflows
- remove one legacy credential at a time and rerun the same checks

Older workflows do not require a manifest rewrite merely because they use a
skill. Once the selected skill declares its requirements, Codex Runtime resolves
them automatically. Existing direct `agentConfig.gatewayCapabilities` entries
remain valid and should only be removed when the step has been converted to use
a capability-declaring skill.

Do not begin with wallet private keys, broad object-storage credentials, social
publishing credentials, or repository write tokens.

## Rollback

Before removing an old integration variable, rollback is:

1. Set `PRISM_GATEWAY_ENABLED=false` on the affected caller.
2. Redeploy that caller.
3. Confirm the old direct path still works.
4. Leave Gateway running for audit inspection or disable its Site UI.

After removing an old integration variable, rollback is:

1. Restore that single variable from the operator's credential source.
2. Set `PRISM_GATEWAY_ENABLED=false` for the affected capability.
3. Redeploy the caller and run its original smoke test.
4. Preserve Gateway audit records for diagnosis.

Do not delete the Gateway volume during an application rollback. Volume deletion
is a separate destructive operation and is not needed to restore old behavior.

## Template Update

After the production pilot is stable:

1. Update `prism-stack-template-source` from the merged implementation.
2. Add the optional `prism-gateway` service with root directory
   `/services/prism-gateway` and a `/data` volume.
3. Generate Gateway encryption and caller tokens with Railway template secret
   functions.
4. Add service-reference variables to Site and Codex Runtime.
5. Keep Gateway disabled by default until its health check succeeds.
6. Generate a new Railway template revision.
7. Deploy that revision into a clean test project.
8. Complete Site bootstrap and Codex device authentication.
9. Add an instance-specific connection and capability through Settings, then run
   the Gateway smoke checks.
10. Update the template variable reference and user-facing service docs.

Publishing the final Railway template revision may require dashboard
confirmation even when service and variable configuration is applied through
the CLI.

## Automation Deliverables

Before merging implementation, add an idempotent setup command that can:

- verify the exact Railway project and environment
- create or locate `prism-gateway`
- create or locate its `/data` volume
- generate missing bootstrap secrets without printing them
- set caller variables through Railway service references
- default all caller feature flags to disabled
- stop before deployments unless explicitly asked to apply

The setup command is:

```bash
bash scripts/railway-setup-prism-gateway.sh \
  --project-id <railway-project-id> \
  --environment production
```

It defaults to a read-only plan. Add `--apply` to provision missing resources
without deploying, or `--deploy` to provision and deploy the current checkout.
The service remains disabled at Site and Codex Runtime callers after setup.
