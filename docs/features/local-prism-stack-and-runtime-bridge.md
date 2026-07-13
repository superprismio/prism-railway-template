# Local Prism Stack And Runtime Bridge

Status: implementation in progress

Depends on: [Prism Capability Gateway](prism-capability-gateway.md)

Related operations guide:
[Local And VPS Deployment](../operations/local-vps-deployment.md)

## Implementation Progress

Implemented in the first slice:

- `prism local` lifecycle commands for init, up, down, status, logs, doctor,
  and browser open
- generated per-instance internal credentials with restrictive file
  permissions
- a Compose control plane for Site, Gateway, Memory, and Task Runner
- persistent local data directories and loopback-only published ports
- a production Site container built from the repository lockfile
- host-native Codex Runtime startup using the operator's existing `CODEX_HOME`
- runtime discovery through `GET /v1/runtime/manifest`
- normalized runtime job submission, polling, and cancellation routes
- Gateway wiring for Site, Task Runner, and the host runtime
- contributor startup coverage for Gateway and Task Runner
- health-gated startup and full-stack restart persistence validation

Still pending:

- Site-owned runtime profiles
- runtime pairing and short-lived assignment credentials
- a second runtime adapter such as Grok Build
- optional communication/media Compose profile
- backup, restore, reset, and packaged CLI distribution

## Purpose

Make a complete Prism instance easy to run on a developer or operator machine
without requiring someone to start, configure, and monitor each service
individually. The local distribution should also make Codex CLI, Grok Build,
and future local agent harnesses interchangeable runtime adapters instead of
making Codex Runtime the permanent center of the stack.

The normal experience should be one command, one authenticated local runtime,
and a short browser setup flow. Railway remains a supported deployment target
with its existing service topology and environment model.

## Goals

- Start the required local Prism control plane with one command.
- Generate internal service tokens, encryption keys, URLs, and data paths.
- Preserve persistent Site, Gateway, Memory, and runtime state across restarts.
- Use the Gateway for organization credential custody and toolset access.
- Let local Codex CLI, Grok Build, and future harnesses implement one runtime
  adapter contract.
- Configure non-secret instance behavior through Prism Console after startup.
- Enter and rotate provider secrets through the server-side Gateway UI, never
  through chat or browser-exposed environment variables.
- Keep communication adapters and media dependencies optional.
- Preserve the current Railway template and deployment behavior.

## Non-Goals

- Do not combine every Prism service into one container or process.
- Do not package Electron or Tauri in the first slice.
- Do not require local runtimes to run inside containers.
- Do not move organization credentials back into a runtime process.
- Do not replace Railway service references, volumes, or deployment settings.
- Do not promise identical operating-system support before the Compose path is
  proven on Linux, macOS, and the supported Windows container environment.
- Do not let chat receive raw provider credentials.

## Product Shape

The user should experience Prism as one local application even though its
services retain separate ownership and lifecycle boundaries:

```text
prism local up
  |
  +-- local supervisor
  |     +-- dependency and port checks
  |     +-- generated internal configuration
  |     +-- health checks, logs, status, and shutdown
  |
  +-- Docker Compose control plane
  |     +-- Site
  |     +-- Prism Gateway
  |     +-- Prism Memory
  |     +-- Task Runner
  |     +-- optional Communication Adapter profile
  |
  +-- host runtime bridge
        +-- Codex CLI adapter
        +-- Grok Build adapter
        +-- future command or ACP adapters
```

The number of services is an implementation detail hidden by the supervisor.
Service separation remains useful for persistence, independent upgrades,
health reporting, mixed Node/Python dependencies, and parity with Railway.

## Two Local Modes

### Contributor Mode

Improve the existing `npm run dev:local` path for repository development. It
should run source processes with readable prefixed logs and include all current
core services, including Gateway and Task Runner. It may continue to require
Node.js and the Prism Memory Python virtual environment.

Contributor mode optimizes for hot reload, debugging, and editing service code.
It is not the primary installation experience.

### Local Instance Mode

Add a Compose-backed distribution managed through `prism local`. It should
provide stable images, persistent volumes, generated local configuration, and
one lifecycle command. Only the runtime bridge and selected AI harnesses remain
host-native.

Local instance mode optimizes for using Prism, testing integrations, and
developing instance-owned skills and workflows without understanding every
service command.

## Why Runtimes Stay Host-Native

Local coding harnesses need access to host authentication, repositories, and
user-approved filesystem locations. Keeping the bridge on the host avoids
mounting broad home-directory credentials into containers and preserves native
CLI behavior.

Examples include:

- Codex authentication and sessions under `CODEX_HOME`
- Grok Build authentication and configuration under its normal home directory
- Git credentials and SSH agents
- repositories outside the Prism checkout
- OS-specific sandbox and permission behavior

The bridge should expose only the normalized Prism runtime contract to Site.
Each adapter owns translation to its harness's CLI, streaming, session, cancel,
and permission model.

## Runtime Adapter Contract

The first contract should be extracted from the existing Runtime job API rather
than designed as an unrelated protocol. At minimum, an adapter must support:

- runtime identity, type, version, and health
- job submission
- normalized prompt and conversation history
- workspace and context assignment
- Gateway toolset/profile assignment
- streamed or polled progress
- normalized final response and artifacts
- cancellation
- session/thread continuity when the harness supports it
- structured errors and timing metadata

Site owns runtime registration, selection, and routing. Gateway owns
organization credential custody, profile assignment enforcement, and audit.
The bridge does not become a second credential store.

The initial implementation should adapt the existing endpoints and semantics:

```text
POST /v1/responses
POST /v1/responses/jobs
GET  /v1/responses/jobs/:id
POST /v1/responses/jobs/:id/cancel
```

Exact versioned routes may change during implementation, but Railway Codex
Runtime and local adapters must share the same behavioral contract.

## Initial Setup Experience

The expected first run is:

```text
1. Install Docker and at least one supported AI harness.
2. Authenticate that harness, for example with `codex login`.
3. Run `prism local up`.
4. Open the local Site URL and create the first admin account.
5. Complete instance setup through Prism Console and Settings > Gateway.
```

The supervisor should generate and persist the following without asking the
operator to invent values:

- internal service tokens
- Gateway master encryption key
- local service URLs and ports
- SQLite and artifact volume paths
- runtime bridge identity and pairing material
- an instance identifier
- Compose project and network names

Generated configuration should live in a local Prism data directory outside
the repository and use restrictive filesystem permissions. Re-running setup
must reuse existing values unless the operator explicitly resets the instance.

The launcher may ask only for choices that cannot be inferred safely, such as:

- which detected runtime adapter to enable
- whether to enable the communication adapter profile
- whether Site should bind only to loopback or the local network
- how to resolve occupied ports

## Chat-Driven Configuration

Once Site, Gateway, and one runtime are healthy, Prism Console should be the
default way to configure the instance. An admin should be able to ask:

> Configure Discord, connect Plausible, and create a weekly analytics workflow.

The configuration agent should:

1. Inspect current instance settings, Gateway connections, skills, workflows,
   hooks, runtime adapters, and adapter policy.
2. Make non-secret changes through existing server-side agent APIs.
3. Identify credentials that are missing without requesting their values.
4. Direct the admin to the appropriate Settings > Gateway connection form.
5. Resume configuration after the admin confirms the credential was saved.
6. Run safe connection and workflow smoke checks and report the result.

Chat may author:

- Gateway connection metadata and toolset/profile configuration
- runtime registration and routing preferences
- skills, workflows, hooks, and tasks
- communication adapter policy
- branding and workspace settings
- retention and feature settings

Chat must not accept, echo, store, or forward raw provider secrets. Secret entry
and rotation stay in the authenticated Gateway settings surface. Advanced and
unattended installations may use protected files or environment injection, but
that is not the normal interactive setup path.

## Runtime Pairing

The local runtime bridge needs a narrow pairing flow rather than a durable Site
service token copied by hand. A first implementation can use a one-time code:

```text
prism local runtime add codex
        |
        +-- bridge reports runtime metadata
        +-- Site displays or confirms one-time pairing code
        +-- Site registers a local runtime identity
        +-- bridge receives renewable local credentials
```

Later iterations should replace broad static Gateway caller tokens with
Site-signed job assignments or Gateway-issued job sessions. A runtime should
receive only the toolsets or compatibility leases assigned to its current job,
with expiration and audit attribution.

## Compose Services And Profiles

The default Compose profile should include:

| Service | Default | Persistent state |
| --- | --- | --- |
| Site | yes | SQLite, instance content, request artifacts |
| Prism Gateway | yes | encrypted connections, profiles, grants, audit |
| Prism Memory | yes | memory database and artifact storage |
| Task Runner | yes | no unique durable state unless implementation requires it |
| Communication Adapter | no | adapter state and recordings when enabled |
| Runtime Bridge | host | runtime sessions and host harness state |

Media capture and Discord voice may require an adapter image containing
`ffmpeg`. They should not increase the default core image or dependency set when
the optional profile is disabled.

Site needs a production-capable container definition for this path. Existing
service Dockerfiles should be reused where practical instead of creating a
separate local build architecture.

## Storage And Backup

Local instance state should use named volumes by default, with an advanced
bind-mount option for operators who want direct filesystem access. The CLI
should eventually provide:

```text
prism local backup
prism local restore <archive>
prism local reset
```

A backup must cover Site, Gateway, and Prism Memory together so references do
not drift. Runtime auth homes remain owned by their respective harnesses and
must not be copied into a Prism backup.

## Local CLI Surface

The first CLI does not need to be a globally published package. A repository
script may establish the behavior before packaging it.

Target commands:

```text
prism local up
prism local down
prism local status
prism local logs [service]
prism local doctor
prism local open
prism local runtime list
prism local runtime add <adapter>
```

`doctor` should check container availability, image/build state, occupied
ports, volume write access, service health, runtime authentication, bridge
pairing, Gateway connectivity, and optional adapter dependencies.

## Railway Compatibility

This feature is additive. It must not require the Railway template to adopt the
local supervisor or change its deployed service graph.

Shared improvements may include:

- a formal runtime adapter contract
- a Site Dockerfile
- service health endpoints
- normalized configuration validation
- runtime registration and routing
- tests that run against both Codex Runtime and a local adapter fixture

Local-only artifacts should include:

- Compose topology and profiles
- generated local secrets and paths
- loopback defaults
- host runtime discovery and pairing
- local lifecycle commands

Railway keeps:

- service references and private networking
- Railway-managed environment variables
- Railway volumes
- independently deployed services
- the existing Codex Runtime deployment until another runtime is deliberately
  selected

CI should build the same service images used by Railway and run a Compose smoke
test. A local convenience change must not silently alter Railway environment
requirements or startup commands.

## Delivery Slices

### Slice 0: Contract And Inventory

- Document the current job API as a runtime adapter contract.
- Inventory service health checks, ports, persistent paths, and required env.
- Classify configuration as generated internal config, operator choice,
  provider secret, or advanced override.
- Add tests around normalized runtime job behavior before extracting adapters.

### Slice 1: Complete Contributor Supervisor

- Add Gateway and Task Runner to the current local development launcher.
- Prefix logs and stop all child processes reliably.
- Wait for health instead of assuming startup order.
- Add `status`, `doctor`, and actionable dependency errors.

This slice gives contributors immediate value but is not the final local
distribution.

### Slice 2: Compose Control Plane

- Add a Site container build.
- Add the default Compose services, network, health checks, and volumes.
- Generate internal configuration on first run.
- Add optional communication/media profile.
- Prove restart persistence and a clean-machine smoke test.

### Slice 3: Host Codex Adapter

- Extract the Codex CLI execution behavior behind the runtime contract.
- Detect local Codex authentication without copying it into a container.
- Pair the bridge with Site.
- Run console Q&A, a task, and a workflow through the local adapter.
- Assign and audit Gateway profiles for each job.

### Slice 4: Additional Runtime Adapter

- Implement Grok Build or another harness through the same contract.
- Prefer a structured streaming or agent protocol where available.
- Verify cancel, session continuity, workspace access, and normalized errors.
- Demonstrate runtime selection without changing a workflow definition.

### Slice 5: Guided Setup

- Add first-run runtime selection and setup status.
- Add Console guidance for missing configuration.
- Deep-link credential requirements to Settings > Gateway.
- Add setup and integration smoke checks.

### Slice 6: Distribution Hardening

- Publish versioned images and a stable CLI/package.
- Add coordinated backup and restore.
- Add upgrade and database migration handling.
- Validate supported operating systems.
- Consider a desktop wrapper only after the daemon and bridge contracts are
  stable.

## Acceptance Criteria

The local MVP is complete when a new operator can:

1. Start a persistent Prism control plane with one command.
2. Open Site without manually authoring internal tokens or service URLs.
3. Pair an already authenticated local Codex CLI runtime.
4. Ask a normal question in Prism Console and receive a response.
5. Add one provider credential through Settings > Gateway without exposing it
   to chat or the runtime's durable environment.
6. Configure and invoke that integration through chat.
7. Run one task and one workflow through the same runtime adapter.
8. Restart the stack without losing instance, Gateway, or Memory state.
9. Diagnose a missing dependency or failed service with `prism local doctor`.
10. Build and smoke-test the unchanged Railway deployment path from the same
    commit.

## Open Questions

- Should the first packaged CLI be a Node workspace package, a standalone
  binary, or a thin shell wrapper around Compose?
- Which structured Grok Build interface is most stable for the second adapter:
  streaming JSON, ACP, or another supported protocol?
- Should local runtime registration be push-based from the bridge or discovered
  by Site through a loopback endpoint?
- What is the minimum supported Docker/Podman and operating-system matrix?
- Should Prism Memory be mandatory in the default profile or selectable for a
  smaller console-only development mode?
- How should LAN access and HTTPS be offered without weakening loopback-only
  defaults?
- When should Site-signed job assignments replace static local pairing
  credentials?

## Decision Summary

- Use one-command orchestration, not one monolithic container.
- Use Compose for the local Prism control plane.
- Keep AI harnesses host-native behind a shared runtime bridge.
- Generate internal bootstrap configuration automatically.
- Use chat for non-secret configuration after startup.
- Use Settings > Gateway for provider secret entry and rotation.
- Keep communication/media services optional.
- Treat Electron or Tauri as a later wrapper around stable local services.
- Preserve Railway as an independent deployment path using the same service
  code and runtime contract.
