# Prism Lab Agent-First Operations Addendum

## Status

Implemented foundation with an active console-first navigation iteration. This addendum
supersedes the profile, ownership, and post-Slice-5 navigation model in
`prism-lab-chat-first-operations.md` where the documents conflict. Slices 0–5
remain implemented and valid foundations.

## Why This Addendum Exists

Field testing clarified that Prism is not only a chat-first request console. It
is being used as a multiplayer agent harness:

- several people interact with agents through Prism Console, Buzz, Discord,
  Telegram, and other interfaces;
- agents run workflows and scheduled tasks on the same shared request state;
- operators need to know who initiated work, which agent performed it, who is
  accountable for that agent, and what changed;
- one required administrative agent needs cross-agent observability,
  orchestration, and bounded repair authority.

The earlier model separated interaction profiles, agent cards, and execution
profiles. Those records remain useful implementation substrate, but they do not
provide one clear operational identity around which sessions, channels,
activity, ownership, and execution can be understood.

The new top-level concept is an **Agent Profile**.

## Product Model

Prism Lab has two first-class global collections:

1. **Requests** are shared collaborative work items. A request may involve
   several agents as its workflow advances and therefore does not belong to a
   single agent.
2. **Agents** are durable operational identities. Agents receive conversations,
   execute workflow steps and tasks, produce artifacts, and retain explicit
   human accountability.

The built-in **Admin Agent** is the required control-plane agent. Other agents
are flat peers rather than members of a required Ops hierarchy. The Admin Agent
may own a sub-agent, but that is an ownership relationship, not automatic
authority inheritance.

```text
Workspace administrators
  -> Admin Agent (required, built in)
       -> may observe, direct, verify, and safely repair work
       -> may own explicitly created sub-agents

Other Agent Profiles
  -> always have a Prism Console
  -> may have zero, one, or many external communication bindings
  -> may execute workflows and tasks
  -> are stewarded by a real user even when owned by the Admin Agent
```

## Information Architecture

The Lab shell uses a collapsible Agent Navigator:

```text
Workspace
  Requests
  Activity
  Settings

Agents
  Admin Agent
  All defined agents
```

The Agents destination separates the protected built-in Admin Agent from other
agents without inventing a Workspace Agent or Ops Agent class:

```text
Admin Agent

Agents
  Veydrift Agent       Console · Buzz · Discord
  Recording Agent      Console · Discord
  Planning Agent       Console only
```

Every Agent Profile has a Prism Console. External communication bindings are
optional. A console-only agent is operational, not "unbound" or private.

Selecting an agent opens an identity-scoped, console-first workspace. The
console occupies the primary canvas, Capture is a peer mode, and an on-demand
right inspector contains profile configuration and observability:

- Console
- Capture
- Activity
- Sessions
- Channels
- Configuration

The left navigator can be collapsed without changing the selected agent. The
right inspector is closed by default so conversation remains the visual focus.

Agent Console execution resolves its scope from the Site-owned session/profile
assignment, not browser-supplied metadata. The resolved immutable profile
version provides persona instructions, runtime profile, skills, memory scope,
authority context, and continuation policy. A profile edit creates a new
version; existing sessions retain their recorded version and a new session is
required to adopt the edit.

Requests remain a top-level global inbox. Agent pages may show requests in
which the agent participated, but must not create competing agent-owned request
silos.

## Agent Profile

An Agent Profile is a versioned operational identity, not only a prompt or a
runtime configuration. Its resolved non-secret configuration includes:

- stable key and display identity;
- mandate and persona;
- status and profile version;
- owner principal: user, workspace, or another Agent Profile;
- one or more human stewards;
- runtime/model selection;
- skills and memory scope;
- authority ceiling and allowed operations;
- workflow and task assignments;
- communication bindings;
- default bounded context policy.

Ownership must be acyclic. If the Admin Agent owns another agent, workspace
administrators remain the ultimate human stewards. Agent ownership never grants
the child the parent's authority or credentials automatically.

### Profiles, templates, skills, and modes

Keep these meanings distinct:

| Concept | Meaning |
| --- | --- |
| Agent Profile | Durable identity with ownership, sessions, authority, and activity. |
| Agent Template | Reusable starting configuration without operational identity or ownership. |
| Skill | A capability an agent or workflow step may use, such as research. |
| Mode | A bounded execution posture such as worker, orchestrator, verifier, reviewer, judge, or repair. |
| Runtime Profile | Adapter and runtime transport configuration; not an agent identity. |
| Binding | Associates an Agent Profile with a communication surface. |

Do not create an agent merely because a capability has a name. Research is
normally a skill. It becomes a distinct agent only when it needs a durable
mandate, owner, memory scope, authority boundary, and independent sessions.

Templates and cloning may be added later. A clone becomes a new Agent Profile
with its own ownership, version history, authority, and activity.

## Required Admin Agent

The Admin Agent is seeded for every workspace and is protected from deletion.
It is stewarded by authorized workspace administrators and has cross-agent
control-plane visibility.

Its responsibilities include:

- inspect agents, sessions, requests, workflows, tasks, runs, blockers, and
  system health;
- explain what is happening and who is responsible;
- direct or delegate work to another agent;
- diagnose and repair allowlisted request or workflow state;
- propose higher-risk repairs for human approval;
- create Agent Profiles through a reviewable Admin Console operation;
- run bounded automated doctor, maintenance, or orchestration loops.

"Can work with everything" does not mean permanently holding every provider
credential. Gateway credentials remain job-scoped leases. The Admin Agent's
effective authority is the intersection of workspace policy, the selected
mode, the requested operation, and any required human approval.

Verifier, reviewer, and judge initially remain bounded modes of the Admin Agent
rather than separate required agents. They may later become independent Agent
Profiles if operational separation justifies it.

```text
Admin Agent
  diagnose/repair mode
  orchestrator mode
  verifier mode
  reviewer mode
  judge mode
```

Automated Admin Agent operation must use bounded iterations rather than one
indefinitely growing conversation:

```text
wake
  -> inspect current durable state
  -> select one repair, delegation, or proposal
  -> execute or request approval
  -> verify and record the outcome
  -> sleep
```

## Ownership And Attribution

Do not overload one "owner" label. Every relevant UI and API read model should
distinguish:

- **initiated by**: the user, source message, task, hook, or system event that
  caused the work;
- **created/configured by**: the user or agent that created an automation,
  binding, workflow, or task;
- **owned by**: the principal accountable for an Agent Profile;
- **stewarded by**: the real user or users ultimately accountable for an agent;
- **executed by**: the exact Agent Profile version and mode that performed a
  run or action;
- **participating agents**: agents whose runs or conversations contributed to
  a request.

Sessions already contain useful provenance. Authenticated Site sessions have a
`createdByUserId`; source messages may contain trusted platform author metadata;
sessions retain channel and interaction-policy metadata. Future request
creation must resolve this trusted state automatically rather than depending on
a model to repeat source IDs correctly.

Prospective provenance rules:

- Console request creation resolves the authenticated session user.
- Buzz, Discord, and Telegram resolve the specific source-message author;
  shared channel sessions are not assigned to the first participant.
- Scheduled requests identify `task:<task-key>` as the immediate initiator and
  separately preserve who configured the task.
- Hook-created requests identify the hook and preserve its configuration
  provenance.
- An agent-created request snapshots the initiating Agent Profile and version.
- Caller-supplied display names never override trusted Site-owned identity.

## Communication Bindings And Sessions

Each external communication surface has one primary Agent Profile. One Agent
Profile may serve zero, one, or many external surfaces.

```text
Buzz #veydrift -----+
Discord #veydrift --+--> Veydrift Agent
Telegram group -----+
```

The Prism Console is implicit for every agent and does not require an external
binding record. A new Console session explicitly selects an agent; Admin Console
always selects the Admin Agent.

Session terminology describes the communication shape, not privacy:

- Console session: one active authenticated participant;
- channel session: shared channel conversation;
- thread session: shared thread conversation;
- direct-message session: one external participant;
- automated session: task, hook, or workflow initiated.

Do not label Console sessions "private." They are observable operational
records. The UI must state that authorized workspace administrators and agent
stewards can inspect them. Transcript access is capability-controlled and
audited.

In shared channel and thread sessions, the session belongs to the agent and
surface while each message retains its actual author.

## Requests And Cross-Agent Execution

Requests remain global because one workflow may involve multiple agents. They
show provenance, workflow state, current executor, participants, human steward
when assigned, and attention—not a forced single agent owner.

```text
Request #1468
  initiated by: Daniel via Buzz
  workflow: Recording Post-Publish
  current executor: Admin Agent · verifier mode
  participating agents: Recording Agent, Admin Agent
  steward: Daniel
```

Workflows are the primary durable cross-agent coordination mechanism. A
workflow may define a default executor, and a step may select another Agent
Profile and bounded mode. A missing step executor inherits the workflow
default.

```yaml
defaultAgent: recording-agent
steps:
  - key: prepare
  - key: verify
    executorAgent: admin-agent
    executionMode: verifier
  - key: publish
```

Executing one step does not transfer request ownership. Each run snapshots the
executor Agent Profile, version, mode, effective authority, and declared input
and output artifacts.

Cross-agent handoffs use explicit bounded artifacts rather than shared runtime
continuations. A handoff includes objective, relevant facts, declared inputs,
constraints, delegated authority, outputs, evidence, unresolved blockers, and
the next handoff. Agent-to-agent work must remain visible in the request
timeline.

Ad hoc Admin Agent delegation should create the same durable child-run or
workflow-step records. Do not add an unaudited agent-to-agent message bus.

## Agent Activity And Session Observability

An Agent page is primarily an identity-scoped activity and interaction surface.
Its activity read model joins existing canonical records rather than creating a
second activity source of truth.

Activity includes:

- workflow-step runs with request, workflow, step, status, mode, and artifacts;
- Console and external-channel conversations with surface and participants;
- task and workflow invocations;
- handoffs to and from other agents;
- Admin Agent interventions;
- profile, authority, skill, steward, and binding changes.

Activity cards show operational metadata, not full message bodies. They link to
a drillable session view.

The session view includes:

- chronological user and agent transcript;
- message-level authors and communication surface;
- Agent Profile and version;
- response jobs, runs, API actions, and outcomes;
- linked requests, workflows, tasks, artifacts, and handoffs;
- skills used and Gateway connection names, never credential values;
- errors, blockers, and collapsible technical traces.

The view should make causality inspectable:

```text
user message
  -> agent response job
  -> Site action
  -> request or workflow run
  -> artifact and outcome
```

## Revised Next Slice: Agent Identity And Observability Foundation

This slice replaces the previous Slice 6 execution-profile-first plan.

### Deliver

1. Add a Site-owned, versioned Agent Profile registry.
2. Seed the required protected Admin Agent.
3. Support user-, workspace-, and Admin-Agent-owned profiles with explicit
   human stewards and cycle-safe ownership.
4. Associate Agent Profiles and resolved versions with Console and source
   sessions.
5. Correct prospective request provenance for authenticated Console users,
   source-message authors, scheduled tasks, hooks, and agent-created work.
6. Add Agent Profile and mode snapshots to new response jobs and workflow-step
   runs without rewriting historical runs.
7. Add `/admin/lab/agents` and agent detail routes with Overview, Console,
   Activity, and Sessions as the first working views.
8. Add a capability-controlled, audited session transcript view.
9. Add deterministic agent creation through an Admin Console review/confirm
   flow. Default the initiating operator to human steward; allow explicit Admin
   Agent ownership.
10. Add zero-to-many external bindings with one primary agent per external
    surface. Preserve existing source-policy restrictions as authority inputs.
11. Display current executor and participating agents on global request detail
    and activity views.

Workflow authoring, task assignment, cross-agent step execution, and automated
Admin Agent repair loops may be implemented incrementally after the identity,
session, and activity foundations are proven. The schema must allow them without
requiring them all in the first deployment.

### Compatibility

- Existing interaction profiles remain valid source access-policy records until
  bindings are migrated; they are not displayed as agent owners.
- Existing `agentConfig.identity` remains a legacy execution label.
- Existing workflows and tasks without Agent Profile assignments continue with
  their current legacy identity and behavior. They are labeled legacy or
  unknown and are never silently reassigned to the Admin Agent.
- Existing request-origin snapshots remain immutable. Correct only prospective
  capture unless a conservative deterministic backfill is possible.
- Existing request numbers, histories, sessions, and run records are unchanged.
- Runtime Profiles remain independent transport configuration.

### Acceptance Criteria

- Admin Agent is present, separately displayed, protected from deletion, and
  resolves to real workspace administrators as ultimate stewards.
- An authorized operator can create an agent from Admin Console, review its
  non-secret policy, choose operator or Admin Agent ownership, and confirm it.
- Every new Console session identifies the selected Agent Profile, version, and
  authenticated participant.
- A source-channel session deterministically resolves its primary agent and
  retains message-level authors.
- New scheduled requests show the task as initiator and preserve the task's
  configurator when known.
- Agent Activity shows workflow-step execution and conversations with links to
  canonical requests, runs, and sessions.
- Authorized operators can drill into a Console or channel session and inspect
  the transcript and resulting actions.
- No UI calls an operational Console session private.
- A request involving several agents remains one global request and lists its
  participants without assigning false ownership.
- Profile ownership cannot cycle or silently widen child authority.
- Secrets and credential values never appear in profile snapshots, transcripts,
  activity payloads, or model prompts.

## Deferred Decisions

- Whether agent templates are instance-owned, source-backed, or both.
- Whether domains are useful as optional grouping metadata.
- When verifier, reviewer, or judge warrants an independent Agent Profile
  instead of an Admin Agent mode.
- Which low-risk Admin Agent repairs may run without human confirmation.
- Whether non-admin users may create agents or only request creation through the
  Admin Agent.

## Configuration Consolidation Addendum

Agent Profiles are the single authored identity and communication-policy
aggregate. Interaction Profiles and the file-backed source-adapter policy are
legacy import sources only and must not remain parallel authoring systems.

The Prism Console is an implicit authenticated binding and defaults to full
access. Discord, Buzz, Telegram, external HTTP, and future communication
bindings each carry an explicit access mode, rate limit, allowed workflows, and
optional narrower thread/group/user overrides. Neither a binding nor one of its
overrides may exceed the parent Agent Profile or binding maximum.

Communication adapters own transport, channel discovery, delivery, and trusted
author identifiers. For every inbound interaction they resolve one effective
Agent Profile version and binding policy from Site. They do not own personas,
skills, memory policy, or channel authority.

Existing channel rules are migrated through the Agents review surface. The
migration creates or reuses an Agent Profile, copies non-secret persona/runtime/
memory configuration, and creates its bindings. Historical policy records stay
readable for rollback and attribution, but their public write routes return a
retired-authoring response. Once all deployed instances have migrated, those
compatibility reads and the adapter fallback can be removed.
