# Change Request Workflow

This workflow covers repository-backed Prism requests that need Codex to triage, implement, and prepare work for human review.

The workflow keeps human gates explicit:

- Triage turns an inbox request into a reviewed plan, linked GitHub issue when appropriate, and durable fix-note artifact.
- Approval starts implementation.
- Implementation creates or updates a request branch and opens a pull request into the target repository base branch when remote access is configured.
- Local Code Review assigns a fresh-context Code Review Agent to inspect the diff, run focused checks, save durable findings, and maintain one idempotent GitHub PR comment.
- External PR Review Checkpoint lets an operator ask the Code Review Agent to refresh GitHub checks and reviews from CodeRabbit, Copilot, or human reviewers.
- Review pauses for final human approval before the workflow closes.

Agent steps use fresh context and durable artifact handoffs. If review needs more work, use the explicit change-step/send-back control to return to implementation with the findings as primary feedback.

## Current Behavior

The workflow run stores the current step and is the source of truth for request progress.
