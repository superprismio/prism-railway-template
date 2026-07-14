# Prism Gateway Migration

Status: active migration runbook

Related plan: [Prism Gateway MVP Implementation Plan](../features/prism-gateway-mvp-implementation-plan.md)

Backup, restore, and encryption operations:
[Prism Gateway Backup, Restore, and Key Rotation](./prism-gateway-backup-restore.md)

Use this runbook for both the production pilot on an existing Prism instance and
the later Railway template update. The migration is additive until one
integration has been proven through Gateway and deliberately removed from its
old runtime environment.

## Automatic Credential-Bundle Upgrade

Gateway schema migration `006_credential_bundles` runs during normal service
startup. It converts existing connections into credential bundles, preserves
encrypted values, derives stable keys, copies legacy environment bindings and
base/discovery configuration, and retains toolset aliases. Site, Codex Runtime,
and Task Runner accept both the new credential keys and old toolset keys during
rolling deployment.

This model and UI upgrade requires no per-instance database command, console
prompt, or content migration. Back up Gateway before deploying as usual, deploy
the services, and verify the Credentials table and one existing job. Moving a
credential that still lives only in Railway into Gateway remains an intentional
one-time secret migration.

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
- Create a Gateway snapshot before credential migration or key rotation, and
  preserve its matching encryption-key version outside the Gateway volume.

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
| `GATEWAY_MASTER_KEY_VERSION` | literal `v1` | yes | Stable identifier written into encrypted rows and backup manifests. |
| `GATEWAY_PREVIOUS_MASTER_ENCRYPTION_KEY` | prior secret | rotation only | Set only with the previous version during the two-key rotation procedure. |
| `GATEWAY_PREVIOUS_MASTER_KEY_VERSION` | prior version | rotation only | Remove with the previous key after re-encryption is verified. |
| `GATEWAY_SITE_TOKEN` | generated secret | yes | Authenticates server-side Site calls. |
| `GATEWAY_CODEX_RUNTIME_TOKEN` | generated secret | yes | Authenticates Codex Runtime toolset calls. |
| `GATEWAY_TASK_RUNNER_TOKEN` | generated secret | yes | Authenticates Task Runner job-scoped credential leases. |
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

| Variable | Source | Initial value |
| --- | --- | --- |
| `PRISM_GATEWAY_ENABLED` | literal | `false` |
| `PRISM_GATEWAY_BASE_URL` | `http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}` | service reference |
| `PRISM_GATEWAY_TOKEN` | `${{prism-gateway.GATEWAY_TASK_RUNNER_TOKEN}}` | service reference |

Enable these variables when a `script-runner` task declares
`agentConfig.gatewayCredentials`. Task Runner leases those credential bundles
for that execution and injects them only into the script child process. Legacy
`gatewayToolsets` assignments remain accepted. Trusted workflow runtime jobs
automatically inherit enabled environment-backed adapter credentials, so generic
or externally sourced skills do not need Prism-specific credential metadata.
Callable HTTP, OpenAPI, and MCP connected services still require an explicit
workflow or skill assignment. Tasks without assigned
credentials do not call Gateway. A declared credential fails closed
when Gateway is disabled, unavailable, or returns a protected environment name.

Before removing an embedded task secret, update the script to read the leased
environment variable, bind that variable in a credential bundle, run
the task successfully, and then remove the secret from `inputConfig.params`.

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

New integrations should use one credential bundle containing encrypted secret
variables and reusable non-secret configuration. The earlier connected-service,
capability, and grant models remain compatibility internals only.

No variable values were read into this document. Run the preflight again before
implementation because Railway state may change.

## Pilot Migration History

This section records the prototype paths used during the 2026-07-10 pilot. It
is historical evidence, not the current setup procedure. Normal deployments
backfill these profiles as aliases to credential bundles.

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
inheritance. The later broad MCP migration removed `NEXTCRM_API_TOKEN`; see the
Broad MCP Toolsets section below.

### Hivemind Broad Toolset

Completed on `prism-stack` on 2026-07-10:

- created the fixed-origin `hive-mind.admin` HTTP toolset with `x-api-key`
  authentication
- validated a read-only project-list call through Gateway
- updated the instance-owned `hivemind-consult` skill to require the toolset and
  removed its direct environment fallback
- validated the toolset through a real Codex Runtime response job
- removed `HIVE_MIND_API_KEY` from Codex Runtime and repeated the runtime smoke
  successfully
- retained Gateway audit trace `800fd6f7-d80b-40c4-873b-d48ce487f81f` as the
  post-removal proof

### Broad MCP Toolsets

Completed on `prism-stack` on 2026-07-10:

- added protocol-aware broad MCP discovery (`tools/list`) and invocation
  (`tools/call`) to Gateway toolset profiles
- kept MCP argument bodies out of Gateway audit summaries
- created `nextcrm.admin`, discovered 113 tools, and validated
  `crm_list_accounts` through Codex Runtime
- removed `NEXTCRM_API_TOKEN`, redeployed Codex Runtime, and retained audit trace
  `8b97a83e-68aa-42e5-a9d2-611b19ffe7d9` as post-removal proof
- created `clawbank.admin`, discovered 151 tools, and validated the read-only
  `get_me` tool through Codex Runtime
- removed `CLAWBANK_API_KEY`, redeployed Codex Runtime, and retained audit trace
  `5c1c114f-4349-41e2-8b39-91cdec092b12` as post-removal proof
- updated Runtime guidance to use Node.js built-in `fetch` because the Runtime
  image does not guarantee that `curl` is installed

### Job-Scoped Compatibility Leases

Completed on `prism-stack` on 2026-07-10:

- added `adapter` profile environment bindings and a Runtime-only credential
  lease endpoint
- limited leases to enabled adapter profiles and audited profile plus variable
  names without recording values
- injected leased values into the assigned Codex child process under existing
  environment names so current skills, CLIs, and SDKs continue to work
- created and validated `storage.s3`, `x.admin`, `bankr.admin`, and
  `wallet.admin` compatibility profiles
- removed the persistent S3 access key pair, seven X credentials,
  `BANKR_API_KEY`, and `PRIVATE_KEY` from Codex Runtime
- updated Git workspace preparation, clone/fetch/push authentication, and child
  jobs to use the same job-scoped GitHub lease
- created `github.admin`, removed `TARGET_REPO_GITHUB_TOKEN`, and validated both
  GitHub API authentication and authenticated `git ls-remote` after removal
- confirmed the migration planner reports no remaining organization integration
  credentials or unclassified sensitive variables in Codex Runtime

Compatibility leases preserve the existing trusted-runtime boundary: the
assigned Codex child can read leased values during its job, just as it could read
the former Railway environment. Gateway is now the durable owner and records
each lease. Use protocol proxy profiles instead when a less-trusted runtime or
external agent must never receive the downstream credential.

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
5. Enable Site Gateway settings and add one test credential bundle.
6. Point only Codex Runtime at the working branch with Gateway disabled.
7. Assign one credential key to a test job.
8. Run one provider operation and verify the result and lease audit event.
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
- A valid assigned credential is injected under the expected environment names.
- An unassigned deterministic job does not receive the credential.
- A Gateway restart preserves the encrypted connection and audit history.
- Replacing or revoking the connection takes effect immediately.
- A missing or revoked credential fails the assigned job closed.

## Existing Credential Migration

Move credentials one at a time:

1. Inventory the skills, workflows, tasks, hooks, and console use that depend on
   the credential. Do not infer this only from Railway variable names.
2. Create a Gateway credential through Site Settings, or let chat prepare the
   non-secret shell and follow its Settings deep link.
3. Store base URLs, site IDs, buckets, and other reusable non-secret values in
   the same credential bundle.
4. Keep generic and source-backed skills unchanged; confirm they read the
   conventional environment variables documented by the provider integration.
5. Assign `agentConfig.gatewayCredentials` to each deterministic task or
   workflow step that needs the bundle. Full-access admin Console and source
   contexts discover active credentials automatically.
6. Do not add new toolsets, capabilities, grants, or provider presets.
7. Deploy Site, Codex Runtime, and Task Runner with Gateway-requirement-aware Doctor
   checks before changing any legacy environment variable.
8. Run Prism Doctor. Repair missing skill references or credential assignments
   before proceeding.
9. Exercise console use plus every enabled workflow, task, and hook identified
    in the inventory. Compare normalized output with the old path.
10. Confirm audit records for each execution path.
11. Disable direct fallback for that integration.
12. Delete the old Railway variable from the runtime service, redeploy, and
    repeat Doctor and the execution matrix.
13. Document the migrated variable and tested callers in the instance's
    environment delta history.

Multiple pending credentials may be prepared through chat. Each returned deep
link opens the secret-entry dialog in Settings. Secret values pass directly from
Site to Gateway, never through chat or an agent route.

For an existing instance with many Codex Runtime variables, use **Import
environment** in Gateway Settings. Paste the Railway `.env` export into the
browser dialog. Secret-like names are selected by default; review the list and
explicitly select any unusually named integration credential. Selected values
are stored independently from connections under their original names. Prism bootstrap tokens, Gateway caller
and encryption material, Railway variables, runtime authentication, and backup
variables are protected and remain in Railway. Non-secret configuration also
remains in Railway.

After import, create a credential shell with the required environment bindings.
Bind a stored value to the credential by name inside Gateway; the credential
resolves the current stored value at use time, so later credential replacement
does not require rebinding. No plaintext passes through chat or an agent route.
Do not remove a legacy runtime variable until
its credential assignment and post-removal smoke test pass.

The credential assignment is a dependency, not a downstream permission model.
The downstream identity enforces its native RBAC. This keeps skills and
workflows portable without reproducing provider permissions in Gateway.

### Instance Upgrade Checklist

Apply this checklist to existing instances when the Gateway-aware runtime is
introduced:

- deploy the new Site and Codex Runtime while all legacy secrets remain present
- deploy the updated Task Runner so Prism Doctor understands skill dependencies
- run Doctor once before editing instance content and retain the report
- add `agentConfig.gatewayCredentials` only to deterministic tasks and workflow
  steps that require explicit assignment
- do not modify generic or source-backed skill repositories solely for Prism
- test direct console use, scheduled tasks, hooks, and representative workflows
- remove one legacy credential at a time and rerun the same checks

Existing `gatewayToolsets` and capability entries remain valid as compatibility
aliases and need no content rewrite during the service upgrade.

## Operations Acceptance

Before removing the last direct credential for an instance:

1. Call `POST /ops/backup`, retain the SQLite file and manifest, and verify the
   snapshot can be opened with `quick_check=ok` using the matching key version.
2. Restart Gateway and confirm credential and audit state
   persists.
3. Verify `GET /health` reports no unavailable encryption versions.
4. Exercise a representative credential lease and provider operation.
5. Record who owns snapshot retention and the matching deployment secrets.

Run one key-rotation drill in a disposable or staging instance before rotating a
production instance. Do not test rotation for the first time against the only
copy of an instance database.

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
9. Add an instance-specific credential bundle through Settings,
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
The setup command deliberately leaves Site and Codex Runtime disabled so an
operator can verify health and create the first connection before enabling both.
