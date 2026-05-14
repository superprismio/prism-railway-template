# Agent PR Review Workflows

Future feature note for Prism request workflows that create or link GitHub pull requests.

## Problem

GitHub-native reviewers such as Copilot or CodeRabbit may not always be available, enabled, or enough for the workflow. Prism should be able to run its own review pass from the request context and linked PR refs.

The goal is not to replace GitHub branch protection or human review. The goal is to give Prism a repeatable, request-aware review loop that can catch issues, summarize risk, and route the workflow before final merge.

## Proposed Shape

Use a distinct workflow step for agent review:

```text
Intake -> Implement -> Open PR -> Agent Review -> Human Review Gate -> Revise -> Await Merge -> Closed
```

The review step should use a fresh reviewer identity, not the same identity as the implementation step.

Example manifest step:

```json
{
  "key": "agent-review",
  "label": "Agent Review",
  "type": "agent",
  "instructionPath": "workflows/github-change-request/steps/agent-review.md",
  "agentConfig": {
    "runtime": "codex-runtime",
    "mode": "reviewer",
    "identity": "prism-code-reviewer",
    "skills": ["change-request-ops", "target-deploy-ops"],
    "delegation": {
      "allowed": false,
      "maxAgents": 0
    }
  },
  "next": "human-review"
}
```

## Step Instructions

`steps/agent-review.md` should be narrow and review-oriented:

```md
# Agent Review

Review the linked GitHub pull request from the perspective of a fresh reviewer.

Do not continue implementation unless the workflow routes to the revise step.

Use:
- linked request context
- linked GitHub issue and pull request external refs
- branch/diff and changed files
- workflow artifacts
- available test output

Focus on:
- correctness bugs
- behavioral regressions
- auth, token, or permission mistakes
- data migration risks
- missing tests for changed behavior
- deployment/config risks
- unclear user-facing workflow behavior

Return:
- blocking findings first, with file/line references when possible
- non-blocking suggestions separately
- a clear recommendation: approve, request changes, or needs human decision

If findings are blocking:
- save the review findings as a request artifact or comment
- update next-step guidance
- route to the revise step

If no blocking findings:
- save a review summary
- continue to the human review gate
```

## External Refs

The review step depends on structured external refs:

```json
{
  "provider": "github",
  "kind": "pull_request",
  "externalId": "42",
  "url": "https://github.com/org/repo/pull/42",
  "state": "open",
  "metadata": {
    "repo": "org/repo",
    "branch": "prism/request-12",
    "base": "main"
  }
}
```

The workflow should attach PR refs when it opens a PR, then later review/poll those refs. GitHub remains authoritative for approvals, checks, and final merge.

## Future Review Modes

Potential specialized review steps:

- `agent-review-fast`: obvious bugs, broken flows, config mistakes.
- `agent-review-security`: auth, tokens, permissions, exposed secrets.
- `agent-review-migration`: DB/data/template upgrade risk.
- `agent-review-product`: UX, workflow fit, content quality.
- `agent-review-docs`: operator clarity and docs completeness.

These should be implemented as workflow steps with specific `agentConfig.identity`, skills, and step markdown rather than hardcoded into the request engine.

## Open Questions

- Should the review agent post comments back to GitHub, Prism only, or both?
- Should Prism run review automatically after PR creation, or only on request?
- Should review findings become a structured artifact type?
- Should a later task poll linked PR state and route `merged`, `closed`, or `changes_requested` outcomes?
