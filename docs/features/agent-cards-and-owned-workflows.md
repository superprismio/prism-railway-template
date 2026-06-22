# Agent Cards And Owned Workflows

## Status

Planned / future.

This captures a product and architecture direction for named agent personas in
Prism without introducing a new execution environment. The working idea is an
"agent card": a reusable, owned operating brief that can be attached to workflow
templates and recorded on runs for provenance.

## Problem

Prism has tasks, hooks, workflows, skills, change requests, and agent runs. These
are enough to execute work, but they do not yet clearly answer:

- who owns a recurring agent process,
- what context that process should use,
- what voice or operating posture it should follow,
- what it is allowed to do,
- what failure modes reviewers should watch,
- which agent/persona a given run came from.

Without that layer, recurring community processes can feel like anonymous
automation. That weakens accountability, auditability, and trust.

The goal is not to create "agents that call agents" or a second workflow engine.
The goal is to make recurring agent-supported processes easier to own, review,
and trace.

## Core Idea

An agent card is a named, owned configuration object:

```txt
Name          identity
Owner         accountable
Job + Sources scope
Failure Mode  watch
```

Examples:

- Queen Raida: communications agent for X/Discord drafts.
- PRD Agent: turns issues, context, and stakeholder notes into scoped PRDs.
- Code Agent: executes bounded implementation requests.
- Content Creator Agent: turns meetings and research into content requests.
- Orchestration Agent: plans and coordinates child workflows without silently
  assigning authority.

Agent cards should fit into the existing Prism stack:

- no new runtime,
- no separate execution queue,
- no hidden workflow engine,
- no direct "agent calls agent" behavior.

## Goals

- Give recurring agent workflows a clear owner and identity.
- Attach one primary agent card to a workflow template and workflow run.
- Snapshot the resolved agent card onto agent runs for provenance.
- Use the agent card to guide context, voice, boundaries, and review criteria.
- Keep workflow steps explicit and visible.
- Support future chat-based creation of agent cards and owned workflows.
- Improve auditability for handoffs, spawned requests, and dynamic work
  proposals.

## Non-Goals

- Do not introduce a new execution environment.
- Do not make one workflow contain multiple primary agent owners in the first
  model.
- Do not hide pre-run or post-run work inside an agent card.
- Do not allow generic "agents can call agents" behavior.
- Do not allow an orchestration agent to silently assign ownership or enable new
  workflow templates.
- Do not build a full task board as the first solution for pending decisions.

## Agent Card Model

Suggested first shape:

```ts
type AgentCard = {
  id: string
  key: string
  name: string
  ownerUserId: string
  description: string | null
  status: "draft" | "active" | "archived"

  job: {
    summary: string
    responsibilities: string[]
    outOfScope: string[]
  }

  sources: {
    knowledgeSources: string[]
    repos: string[]
    memoryBuckets: string[]
    prefillInstructions: string | null
  }

  persona: {
    voice: string | null
    brandRules: string[]
    examples: string[]
    visualStyleRefs: string[]
  }

  boundaries: {
    mode: "draft_only" | "propose_changes" | "approved_writes"
    allowedSkills: string[]
    allowedPlatforms: string[]
    allowedActions: string[]
    requiresHumanApprovalFor: string[]
  }

  reviewCriteria: {
    successCriteria: string[]
    safetyChecks: string[]
    requiredArtifacts: string[]
    failureModes: string[]
  }
}
```

This can start smaller:

- name,
- owner,
- job,
- sources,
- failure modes,
- instructions,
- allowed skills,
- default review criteria.

## Relationship Model

Start with one primary agent card per workflow template:

```txt
agent_card 1 -> many workflows
workflow 1 -> many workflow runs
workflow run snapshots the resolved agent card
agent_run records the resolved agent card/version
```

Suggested fields:

```txt
workflows.agent_card_id
workflow_runs.agent_card_id
agent_runs.agent_card_id
agent_runs.agent_card_snapshot_json
```

Requests may inherit an agent card from the selected workflow. A direct
request-level override can wait until there is a clear product need.

## Workflow Ownership

Use this first rule:

```txt
One workflow run has one primary agent card.
```

This keeps accountability clean. A Queen Raida workflow can have many explicit
steps, but they are all phases of Queen Raida's work:

```txt
load brand/context
draft announcement
run public-output-safety
human review
publish/handoff
```

If another owner or persona is needed, use a handoff to another workflow rather
than a multi-agent workflow:

```txt
Research Agent workflow
  -> child request/workflow for Content Creator Agent
  -> child request/workflow for Safety Reviewer
```

Multi-agent workflows are out of scope for the first slice. Workflow chaining is
the preferred future pattern for cross-agent handoffs.

## Explicit Steps

Agent cards may suggest a default workflow shape, but the workflow should render
all important work as explicit nodes.

Common shape:

```txt
preflight/context
main work
validation
human gate
handoff/publish
```

The agent card can recommend preflight and review steps. The workflow owns the
actual nodes.

Avoid hidden behavior such as:

```txt
agent card secretly runs pre/post hooks
```

Prefer visible workflow steps:

```txt
collect-context -> draft -> safety-check -> human-review -> publish
```

## Boundaries

The agent card defines a broad boundary. Workflow steps can narrow it.

Recommended policy rule:

```txt
effective permissions = agent card boundaries intersect workflow step permissions
```

Example:

```txt
Queen Raida card:
- draft only unless approved
- allowed platforms: X, Discord
- allowed skills: public-output-safety, brand-style

Draft step:
- may create draft artifact

Publish step:
- requires human approval
```

The workflow remains the control plane for gates, branching, approvals, retries,
and publishing.

## Chat-Based Creation

Creating an agent card should be conversational, not form-first.

Example prompts:

- What should this agent be responsible for?
- Who owns it?
- What sources should it trust?
- What should it never do?
- What failure mode should reviewers watch?
- Should it draft only, propose changes, or perform approved writes?
- What review criteria make the work acceptable?

Prism can turn the conversation into a structured agent card and then suggest an
explicit workflow shape:

```txt
Based on this agent card, I suggest these workflow nodes:
1. collect context
2. draft
3. validate safety and brand fit
4. human approval
5. publish handoff
```

The operator approves or edits the card and workflow before activation.

## Handoffs And Spawned Requests

Existing workflows can spawn new change requests from nodes. That is useful for
modularity, but it needs stronger audit links.

Future handoff metadata should record:

```txt
parent request
parent workflow run
parent step key
source agent card
child request
child workflow
suggested child agent card
handoff reason
handoff payload/artifacts
approval status
```

This turns a spawned request into an auditable handoff rather than an isolated
new item.

Example:

```txt
Research Agent gathers sources
-> creates 3 proposed blog draft requests
-> suggests Content Creator Agent as owner
-> operator approves or edits assignments
```

Suggested fields:

```txt
change_requests.parent_request_id
change_requests.created_by_workflow_run_id
change_requests.created_by_workflow_step_key
change_requests.created_by_agent_card_id
change_requests.handoff_reason
change_requests.handoff_payload_json
```

## Dynamic Work Proposals

Avoid:

```txt
agent calls agent
```

Prefer:

```txt
agent proposes work for an owner/workflow
```

An orchestration workflow may determine that additional work is needed. It can
create a proposed child request or workflow proposal, but it should not silently
assign authority.

Example proposal:

```ts
type ProposedWork = {
  title: string
  reason: string
  suggestedAgentCardKey: string | null
  suggestedOwnerUserId: string | null
  suggestedWorkflowKey: string | null
  requiredInputs: string[]
  sourceArtifactIds: string[]
  approvalRequired: true
}
```

Core rule:

```txt
Dynamic planning is allowed.
Dynamic authority is not implicit.
```

Trusted, low-risk workflows may later use explicit policy to auto-start bounded
child work:

```txt
autoStartAllowed: true
allowedSuggestedWorkflows: ["blog-draft", "source-summary"]
maxChildren: 3
requiresHumanApprovalAboveRisk: "medium"
```

## Orchestration Workflows

Some future workflows will coordinate other workflows:

```txt
PRD Agent creates task checklist
Orchestration Agent selects next task
Code Agent workflow executes one bounded task
Checkpoint evaluates result
Loop until checklist is complete
Final review
```

This should be modeled as an orchestration workflow that owns the plan and
creates child workflow requests. Specialist workflows remain bounded and owned
by their own cards.

Checkpoint nodes become the natural control point:

```txt
checkpoint: evaluate child result
routes:
  next_task -> propose/spawn next child workflow
  needs_review -> human gate
  done -> final summary
```

Loop/orchestration semantics should wait until handoff auditability is strong.

## Pending Actions

A full task board is likely premature. The nearer-term need is a unified queue
of things that need attention.

Pending actions can represent:

- human review gates,
- agent review gates,
- proposed child requests,
- assignment approval,
- publish approval,
- retry decisions,
- orchestration checkpoint decisions.

Suggested shape:

```ts
type PendingAction = {
  id: string
  kind:
    | "human_gate"
    | "agent_review"
    | "proposed_child_request"
    | "assignment_review"
    | "publish_review"
    | "retry_decision"
  title: string
  status: "open" | "resolved" | "canceled"
  requestId: string | null
  workflowRunId: string | null
  workflowStepKey: string | null
  agentCardId: string | null
  ownerUserId: string | null
  assignedUserId: string | null
  priority: string
  dueAt: string | null
  payload: Record<string, unknown>
  createdAt: string
  resolvedAt: string | null
}
```

Start as a "Needs Review" or "Pending Actions" queue. Let it evolve into a board
only if operators need backlog planning, dependencies, swimlanes, or due dates.

## Example Agent Cards

### Queen Raida

- Owner: communications lead.
- Job: draft and prepare public communications for X and Discord.
- Sources: brand repo, voice guide, recent public posts, campaign notes.
- Boundaries: draft only; no direct publish without approval.
- Failure modes: unsupported claims, off-brand voice, unsafe public output,
  stale campaign context.
- Review: public-output-safety, brand fit, source grounding.

### PRD Agent

- Owner: product steward.
- Job: turn issues, community context, and stakeholder notes into scoped PRDs.
- Sources: repo docs, GitHub issues, product notes, contributor rules.
- Boundaries: may create change requests and draft PRDs; no code writes.
- Failure modes: vague acceptance criteria, missing constraints, over-scoped
  implementation.
- Review: acceptance criteria, dependencies, stakeholder review.

### Code Agent

- Owner: engineering steward.
- Job: execute bounded implementation tasks.
- Sources: target repo, issue/PRD artifacts, contributor guide, test docs.
- Boundaries: repo writes through approved workflow only.
- Failure modes: missing tests, broad refactors, unclear handoff.
- Review: typecheck/test result, diff summary, PR notes.

### Content Creator Agent

- Owner: content lead.
- Job: turn meetings and research into content briefs or draft requests.
- Sources: transcripts, meeting notes, content calendar, source artifacts.
- Boundaries: drafts and child requests only.
- Failure modes: misquoting speakers, weak source grounding, duplicated content.
- Review: citations, source excerpts, publish checklist.

## First Implementation Slice

1. Add `agent_cards` with owner, name, job, sources, boundaries, and review
   criteria.
2. Add `agent_card_id` to workflows and workflow runs.
3. Snapshot agent card metadata onto `agent_runs`.
4. Show agent card identity and owner in workflow/run history UI.
5. Inject selected card instructions and allowed skills into workflow run
   prompt construction.
6. Add chat-assisted agent card creation that outputs a draft card and suggested
   explicit workflow nodes.
7. Keep handoffs as existing spawned requests, but add parent/child provenance
   fields.

## Later Work

- Source-backed agent cards from GitHub.
- Agent card versioning.
- Strong policy enforcement for boundaries.
- Pending Actions / Needs Review queue.
- First-class handoff review and assignment approval.
- Orchestration workflows with checkpoint-controlled loops.
- Workflow proposal artifacts for dynamically suggested workflow templates.

## Open Questions

- Should agent cards be instance-owned only, or also source-backed from GitHub?
- Should workflows snapshot the card at run start or always read the latest
  active card?
- Should custom workflows be allowed to override an agent card's boundaries, or
  only narrow them?
- How should card versioning appear in run history?
- Should proposed child work create a change request immediately in draft state,
  or wait as a pending action before creating the request?
- When does a pending action become a board item, if ever?
