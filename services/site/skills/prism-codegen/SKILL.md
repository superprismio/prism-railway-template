---
name: prism-codegen
description: Implement an approved Prism change request in its target repository, using bounded native Codex subagents when the work divides into independent ownership areas.
---

# Prism Codegen

Own the implementation outcome in the parent run. Read the approved plan and durable review artifacts, make the scoped change, integrate all work, run the relevant full checks, and prepare the durable workflow handoff.

## Delegate selectively

When delegation is runtime-enabled, delegate when there are at least two independent, coherent workstreams that can proceed without resolving the same immediate blocker. Otherwise, keep the work in the parent run.

- Prefer `explorer` for read-heavy codebase mapping, policy discovery, or focused investigation.
- Prefer `worker` for a bounded implementation or verification task with a disjoint file or module scope.
- Give each subagent a concrete goal, owned paths or modules, constraints, acceptance check, and expected summary.
- Do not create overlapping write scopes or nested delegation. Keep coupled changes in the parent run.
- Wait for the delegated work, review its actual result, and resolve conflicts or incomplete work yourself.

The runtime-enforced workflow limit is authoritative. Do not try to exceed it or work around a disabled delegation policy.

## Parent-run responsibilities

The parent run retains the approved plan, integration decisions, repository-wide validation, durable artifacts, and final response. It alone performs commits, pushes, pull-request or issue updates, deployments, and other external mutations.

Before handing off:

- inspect the combined diff and repository status
- run the checks needed for the complete change, not only each delegated slice
- confirm the result remains within the approved request and repository instructions
- report the branch, commit, pull request, tests, preview, and unresolved risks when available

If the work returns from code review, treat the open findings in `code-review.json` as implementation inputs while preserving finding history.
