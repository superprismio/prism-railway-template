# Prism Access: Role Ownership And Delegation

## Status

Future feature / exploration.

This document proposes an optional access service for role-based ownership,
delegated administration, runtime subagents, and audit across a Prism instance.
It extends the fixed roles described in [Member Roles](./member-roles.md) without
requiring the Site service to absorb a large organization-governance subsystem.

## Problem

Prism currently has useful but separate access concepts:

- signed-in Site users have `admin`, `moderator`, or `member` privileges,
- Discord and Telegram targets have source-adapter access policies,
- workflows, skills, tasks, requests, and agent profiles have informal owners,
- runtime jobs and their subagents act with credentials supplied to the run,
- Gateway stores credentials and records credential use.

This works for a small instance, but it does not provide a simple answer to:

- who owns a workflow, skill, agent profile, or operational area,
- who may manage a team without becoming a workspace admin,
- which role an operator or agent was acting for,
- how a parent team delegates narrower authority to a child team,
- how an admin inspects or recovers delegated access,
- how agent actions remain attributable to a person, task, or parent run.

The first goal is streamlined permission management with real ownership and
accountability. It is not to predict every governance model an organization may
eventually want.

## Product Goals

- Let admins create organization-specific roles instead of relying only on the
  three built-in Site roles.
- Let a role create and manage narrower child roles within its own authority.
- Let roles own Prism resources so responsibility survives member turnover.
- Let humans and runtime-spawned subagents act in an explicit role context.
- Give admins full visibility, recovery, and role-context inspection.
- Record the actual actor, acting role, source, and delegated authority for each
  privileged action.
- Keep source-adapter policies and Gateway credential custody compatible with
  the model rather than moving them into the access service.
- Keep the feature optional so small and local Prism instances remain simple.

## Non-Goals

The first slice does not include:

- voting, councils, quorum rules, or proposal governance,
- multi-parent roles or a general policy graph,
- temporary delegation and approval chains,
- row-level authorization for every downstream application,
- replacement of Discord or Telegram channel policy,
- replacement of downstream application RBAC,
- a new agent runtime or workflow engine,
- independently authenticated external agents,
- agents that can grant themselves authority,
- Gateway-owned organization authorization.

These should be added only in response to a concrete use case.

## Service Boundary

The preferred architecture is an optional service tentatively named
`prism-access`.

### Site retains

- user authentication and signed sessions,
- the built-in `admin`, `moderator`, and `member` fallback,
- users and workspace membership,
- skills, workflows, tasks, requests, hooks, and agent profiles,
- enforcement at Site UI and API routes,
- an emergency workspace-admin recovery path.

### Prism Access owns

- custom roles and their parent relationships,
- role memberships and agent-profile assignments,
- role permissions and controlled resource scopes,
- role ownership metadata,
- acting-role authorization decisions,
- role-management and authorization audit events.

### Gateway retains

- encrypted credential custody,
- credential resolution for an authorized execution context,
- credential-use audit.

Gateway should consume the resolved execution context. It should not duplicate
the role hierarchy or become the source of organization permissions.

### Source adapters retain

- Discord and Telegram target, user, and group policies,
- read-only versus full-access channel configuration,
- platform identity resolution.

An adapter invocation should pass its platform identity and policy result to
Site. Site then resolves the Prism user, role context, and permitted action.

### Runtimes retain

- execution of agent runs,
- spawning and coordinating runtime subagents,
- enforcing the resolved run context supplied by Site.

Codex, Grok, and future runtimes use the same resolved context. Prism Access
does not depend on a particular runtime CLI.

## Core Model

### Role

```ts
type AccessRole = {
  id: string
  key: string
  name: string
  description: string | null
  status: "active" | "suspended" | "archived"
  managedByRoleId: string | null
  createdByActor: ActorRef
  createdAt: string
  updatedAt: string
}
```

A role has at most one managing parent. Root roles are created and managed by a
workspace admin.

### Membership

```ts
type RoleMembership = {
  roleId: string
  principal: HumanPrincipal | AgentProfilePrincipal
  status: "active" | "suspended"
}
```

The first slice supports signed-in humans and configured agent profiles as
durable members. Runtime subagents are temporary delegated principals and are
not stored as durable role members.

### Permission

Use a compact action vocabulary instead of embedding application-specific
schemas in Prism Access:

```ts
type RolePermission = {
  roleId: string
  action: string
  scope: "own" | "children" | "descendants" | "workspace"
  resourceType?: string
}
```

Example actions:

- `requests.view`
- `requests.manage`
- `workflows.run`
- `workflows.manage`
- `skills.use`
- `skills.manage`
- `agent_profiles.run`
- `agent_profiles.manage`
- `roles.manage_children`
- `audit.view`

The vocabulary should grow from actual Site operations. Avoid defining every
possible downstream API operation.

### Resource ownership

```ts
type ResourceOwnership = {
  roleId: string
  resourceType: "workflow" | "skill" | "task" | "request" | "agent_profile"
  resourceId: string
}
```

Ownership belongs to the role, not an individual member. A member leaving the
role therefore does not orphan the resource.

## Role Hierarchy Rules

The hierarchy is delegation, not unrestricted inheritance.

1. Workspace admins retain control over every role.
2. A role with `roles.manage_children` may create and manage direct child roles.
3. A child role may receive only permissions and resource scopes controlled by
   its managing parent.
4. A child role cannot modify its parent, act upward, or expand its own scope.
5. A role cannot grant a permission it does not hold.
6. Suspending a parent suspends delegated authority below it until restored or
   reparented by an admin.
7. Cycles are invalid, and each role has no more than one managing parent.
8. Admins may inspect, edit, suspend, archive, or reparent any role.

This produces a tree that is understandable in the UI and straightforward to
audit. More flexible graphs can wait for demonstrated need.

## Acting Role

Every privileged operation should resolve an acting role.

A human with several memberships selects a role or accepts the context inferred
from the resource. Authorization evaluates both the actual principal and the
acting role.

Admins receive two explicit tools:

- **View as role**: render permissions and visible resources without allowing
  mutations.
- **Act as role**: perform an operation using that role's authority while
  retaining the admin's real identity in the audit record.

This is role-context switching, not user impersonation. The UI must continue to
show that the admin is acting as another role.

## Runtime Subagents

Audit, observer, and orchestration agents discussed in this model are normally
subagents spawned by the selected runtime. They are not independently
authenticated external agents.

A runtime subagent:

- inherits the parent run's authenticated subject and acting role,
- receives an equal or narrower delegated permission scope,
- cannot gain authority unavailable to the parent run,
- records its subagent identity and parent run in audit events,
- loses authority when the parent run, execution lease, or delegation expires,
- cannot alter its own role assignment or permissions.

Suggested reusable agent profiles are permission bundles, not hard-coded agent
classes:

- **Audit**: inspect audit records and resources in the acting role's scope.
- **Observer**: inspect requests and workflows and create findings.
- **Orchestrator**: run approved workflows, assign work, and invoke approved
  skills for owned or descendant resources.
- **Role manager**: manage child roles only when the acting role explicitly has
  `roles.manage_children`.

An orchestration subagent acting for a parent role may operate on descendants
only when its delegated permissions use `children` or `descendants` scope.

### External agents

An external agent would authenticate independently as a service principal and
receive its own durable role assignment. That requires service-principal
lifecycle, token issuance and revocation, and separate operational controls. It
is intentionally deferred; runtime subagents do not require that infrastructure.

## Authorization Contract

Site remains the enforcement point for its routes. It can ask Prism Access for
a decision using a small internal contract:

```http
POST /v1/authorize
```

```json
{
  "principal": { "type": "user", "id": "user-123" },
  "actingRoleId": "content-team",
  "action": "workflows.run",
  "resource": { "type": "workflow", "id": "weekly-blog" },
  "context": {
    "source": "discord",
    "targetId": "channel-456",
    "parentRunId": null
  }
}
```

```json
{
  "allowed": true,
  "decisionId": "decision-789",
  "actingRoleId": "content-team",
  "reason": "role_permission_and_owned_resource",
  "resolvedScope": "descendants"
}
```

The decision should not contain provider credentials. Site uses the result to
construct a short-lived execution context for Runtime, Task Runner, or Gateway.

## Runtime Execution Context

An agent run should receive a signed, short-lived context such as:

```json
{
  "subject": { "type": "user", "id": "user-123" },
  "actingRoleId": "content-team",
  "source": { "type": "discord", "id": "channel-456" },
  "requestId": "request-42",
  "runId": "run-99",
  "permissions": ["skills.use", "workflows.run"],
  "resourceScopes": ["role:content-team", "role-subtree:content-team"],
  "expiresAt": "2026-07-15T18:30:00Z"
}
```

Subagent contexts add `parentRunId`, `subagentId`, and a reduced permission set.
The Runtime should not be responsible for recalculating the organization tree.

## Gateway Integration

Gateway credentials remain leased or resolved for the execution context, but
credentials are not memberships and Gateway connections are not roles.

The first integration rule is:

```txt
authorized Site operation + resolved acting role
  -> bounded runtime execution context
  -> Gateway credential resolution
  -> downstream service enforces its native access
```

Role configuration may identify which stored credentials or connected services
a role is allowed to use. Gateway should evaluate the supplied resolved context
or a Site-issued credential assignment, not implement a second role system.

## Audit Model

Every privileged event should answer:

- who actually initiated it,
- which role they acted as,
- whether a runtime subagent performed it,
- what source initiated the action,
- what resource and action were involved,
- which authorization decision allowed or denied it,
- whether an admin used act-as or recovery authority.

```ts
type AccessAuditEvent = {
  id: string
  occurredAt: string
  actor: ActorRef
  actingRoleId: string | null
  adminActAs: boolean
  source: { type: string; id: string | null }
  parentRunId: string | null
  subagentId: string | null
  action: string
  resource: { type: string; id: string }
  decision: "allowed" | "denied"
  reason: string
  decisionId: string | null
}
```

Site, Prism Access, and Gateway may each retain events relevant to their own
boundary. The UI can present a combined audit view without forcing one service
to own every raw event.

## Examples

### Content delegation

`Content Team` owns the weekly-blog workflow and creates:

- `Blog Editors`, which may run and manage the workflow,
- `Blog Contributors`, which may draft and comment but not publish.

An editor leaves the organization. Removing their membership does not affect
workflow ownership or the other editors.

### Community operations

`Community Operations` creates `Event Coordinators` and `Discord Moderators`.
The source adapter still determines which Discord channels are read-only or
full-access. The role determines which Prism operations the identified user may
perform after the adapter accepts the source.

### Orchestration subagent

A Community Operations member starts an orchestration run while acting as that
role. The runtime spawns an observer subagent to inspect descendant event
workflows and an orchestration subagent to run an approved follow-up workflow.
Both subagents inherit narrower scopes, and every action records the human,
acting role, parent run, and subagent.

### Admin recovery

A parent role is left with no active managers. A workspace admin views the
instance as that role, confirms its owned resources, assigns a new manager, and
records the recovery action. The admin never impersonates a former member.

## UI Direction

If external access management is enabled, Site may show an `Access` navigation
item linking to or embedding the Prism Access admin surface.

The first UI needs only:

- a role tree,
- role detail with parent, members, permissions, and owned resources,
- create/edit/suspend child-role controls,
- human and agent-profile assignment,
- admin `View as` and `Act as` controls,
- searchable audit history.

Do not begin with a visual policy builder. Forms and a readable effective-access
summary are sufficient.

## Optional Deployment

Small instances should continue using built-in Site roles without deploying a
new service.

Suggested configuration:

```env
PRISM_ACCESS_MODE=builtin
PRISM_ACCESS_BASE_URL=
PRISM_ACCESS_SERVICE_TOKEN=
```

Modes:

- `builtin`: preserve current Site role behavior.
- `external`: use Prism Access for custom roles and authorization decisions,
  while retaining emergency admin recovery in Site.

The optional service can follow the existing Prism deployment pattern:

- one service process,
- SQLite on a mounted volume,
- internal Railway networking by default,
- service-token authentication for Site calls,
- a small browser admin surface protected through Site admin identity.

## Availability And Recovery

- Cache successful read decisions briefly to avoid unnecessary request latency.
- Fail closed for privileged writes when Prism Access is unavailable.
- Continue to permit a narrowly scoped emergency Site-admin recovery path.
- Do not silently fall back from custom-role authorization to broad built-in
  admin access.
- Export role, membership, ownership, and audit data through a documented backup
  path.

## First Slice

1. Add the optional service with SQLite persistence and internal service auth.
2. Implement role tree, memberships, permissions, and resource ownership.
3. Add `/v1/authorize` and a Site client behind `PRISM_ACCESS_MODE`.
4. Enforce a small set of high-value Site actions: requests, workflow runs,
   skill use, role management, and audit viewing.
5. Add acting-role selection and admin view-as/act-as.
6. Pass signed execution context to Runtime and preserve it for subagents.
7. Connect Gateway credential resolution to the resolved execution context
   without moving role logic into Gateway.
8. Add audit records and an initial audit UI.

## Deferred Work

- independently authenticated external agents and service principals,
- temporary or expiring memberships,
- approval rules for high-risk role changes,
- multi-parent roles,
- richer permission conditions,
- cross-workspace roles and federation,
- automatic downstream-role synchronization,
- organization-specific governance plugins.

## Open Questions

- Which existing Site actions form the smallest useful permission vocabulary?
- Should resource ownership be stored in Site with role IDs, in Prism Access, or
  mirrored with one system authoritative?
- How should a Discord or Telegram identity map to a Site user when no signed-in
  account has been linked?
- Which agent-profile assignments should be durable role members versus
  workflow-level configuration?
- What is the minimum emergency-admin action set when Prism Access is down?
- How should audit retention and export work across Site, Prism Access, Runtime,
  and Gateway?

## Success Criteria

The feature is successful when:

- a team owner can create a narrower child role without workspace-admin help,
- the child role cannot exceed the parent's authority,
- workflows and skills can be owned by roles rather than individuals,
- admins can inspect and recover every role without impersonating users,
- runtime subagents operate with no more authority than their parent run,
- Discord and Telegram access policies continue to work as they do today,
- Gateway continues to own credentials without becoming the organization RBAC,
- every privileged action identifies the real actor and acting role,
- instances that do not need custom roles can keep using the current built-in
  model without deploying Prism Access.
