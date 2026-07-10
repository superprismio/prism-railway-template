# Prism Gateway Migration

Status: active migration runbook

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
- Do not fall back after Gateway caller authentication, profile-assignment, or
  fixed-destination denial.
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

Generate a grouped, non-secret migration plan for Codex Runtime:

```bash
node scripts/railway-prism-gateway-migration-plan.mjs codex-runtime \
  > /tmp/prism-gateway-migration-plan.json
```

The planner classifies known integration credential groups, retained
service/runtime credentials, non-secret configuration, and repository
references. It reads Railway variable JSON in-process but emits names only.
Review `unclassifiedSensitiveVariables` before making changes. The plan does
not copy credentials, create broad profiles with guessed protocols, or remove
variables.

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
| `GATEWAY_CODEX_RUNTIME_TOKEN` | generated secret | yes | Authenticates Codex Runtime toolset calls. |
| `GATEWAY_TASK_RUNNER_TOKEN` | generated secret | later | Add when task-runner invokes Gateway directly. |
| `SITE_INTERNAL_URL` | Railway service reference | deferred | Not required for credential custody or tool relay. |
| `SITE_INTERNAL_TOKEN` | Railway service reference | deferred | Not required unless a later feature needs a Site callback. |

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
integration credential or toolset.

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

## Pilot Migration History

### RaidGuild Arcade Read API

Completed on `prism-stack` on 2026-07-10:

- moved `ARCADE_AGENT_API_KEY` from Codex Runtime into one encrypted Gateway
  connection
- created fixed read capabilities for Brood Tapper and Hack Thy Sack scores and
  daily summaries
- added the source-backed `rg-arcade-reader` skill with
  `metadata.gateway-capabilities`
- verified both games through a Codex Runtime job submitted with an empty
  capability list, proving skill requirement inheritance
- redeployed Codex Runtime without `ARCADE_AGENT_API_KEY` and repeated the same
  successful two-game query
- retained non-secret game base URLs in runtime configuration for compatibility
  and instance inventory

The NextCRM contact-read pilot also proved constrained MCP invocation and skill
inheritance, but `NEXTCRM_API_TOKEN` remains in Codex Runtime because that token
still supports broader CRM reads and writes not represented by
`crm.contact.read`.

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
5. Enable Site Gateway settings and add/test one instance connection and
   toolset profile.
6. Point only Codex Runtime at the working branch with Gateway disabled.
7. Assign one toolset profile to Codex Runtime.
8. Invoke one discovered operation/tool and verify the result, trace ID, and
   audit event.
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
- A valid assigned toolset operation succeeds with a stable trace ID.
- An unassigned profile creates a denial audit event and does not call the
  provider.
- A Gateway restart preserves the encrypted connection and audit history.
- Replacing or revoking the connection takes effect immediately.
- Disabling Gateway restores the explicitly configured compatibility path.
- A profile-assignment denial never falls through to direct provider access.

## Existing Credential Migration

Move credentials one at a time:

1. Inventory the skills, workflows, tasks, hooks, and console use that depend on
   the credential. Do not infer this only from Railway variable names.
2. Create a Gateway connection through Site Settings.
3. Create and test a toolset profile backed by the connection's OpenAPI, MCP, or
   fixed-origin HTTP surface without changing runtime behavior.
4. Declare the profile once in each integration skill's `SKILL.md` frontmatter
   under `metadata.gateway-toolsets`.
5. Ensure workflow steps reference the skill through `agentConfig.skills` and
   tasks request it through `instructionConfig.requestedSkills`. Do not copy the
   profile list into every workflow, task, or hook.
6. Keep existing `metadata.gateway-capabilities` and
   `agentConfig.gatewayCapabilities` only for narrow compatibility wrappers.
7. Assign the corresponding toolset profile through Site/runtime/source policy.
8. Deploy Site, Codex Runtime, and Task Runner with Gateway-requirement-aware Doctor
   checks before changing any legacy environment variable.
9. Run Prism Doctor. Repair missing skill references and missing or disabled
   toolset profiles before proceeding.
10. Exercise console use plus every enabled workflow, task, and hook identified
    in the inventory. Compare normalized output with the old path.
11. Confirm audit and latency records for each execution path.
12. Disable direct fallback for that integration.
13. Delete the old Railway variable from the runtime service, redeploy, and
    repeat Doctor and the execution matrix.
14. Document the migrated variable and tested callers in the instance's
    environment delta history.

Multiple pending connections may be prepared before step 2. Site Settings then
shows one **Complete setup** action that accepts all missing credentials in a
single admin session. The batch request sends secret values directly from Site
to Gateway, never through chat or an agent route. Validation and legacy variable
removal remain per integration so one failed provider cannot invalidate the
others silently.

The toolset declaration is a dependency, not a downstream permission model.
Codex Runtime adds skill requirements to a short-lived Gateway session; Gateway
verifies profile assignment, while the downstream identity enforces its native
RBAC. This keeps skills and workflows portable without reproducing provider
permissions in Gateway.

### Instance Upgrade Checklist

Apply this checklist to existing instances when the capability-aware runtime is
introduced:

- deploy the new Site and Codex Runtime while all legacy secrets remain present
- deploy the updated Task Runner so Prism Doctor understands skill dependencies
- run Doctor once before editing instance content and retain the report
- add `metadata.gateway-toolsets` to custom and source-backed broad integration
  skills
- repair only true missing skill references or unavailable profiles/wrappers; do not
  add duplicate toolset arrays to every workflow
- test direct console use, scheduled tasks, hooks, and representative workflows
- remove one legacy credential at a time and rerun the same checks

Older workflows do not require a manifest rewrite merely because they use a
skill. Once the selected skill declares its toolset requirements, Codex Runtime
resolves them automatically. Existing direct capability entries remain valid as
compatibility wrappers.

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
2. Set `PRISM_GATEWAY_ENABLED=false` for the affected profile/integration.
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
9. Add an instance-specific connection and toolset profile through Settings,
   then run the Gateway smoke checks.
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
