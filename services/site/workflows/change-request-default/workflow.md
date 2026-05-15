# Change Request Workflow

This workflow covers repository-backed Prism requests that need Codex to triage, implement, and prepare work for human review.

The workflow keeps human gates explicit:

- Triage turns an inbox request into a reviewed plan and durable fix-note artifact.
- Approval starts implementation.
- Implementation creates or updates a request branch and opens a pull request into the target repository base branch when remote access is configured.
- PR Review Checkpoint lets an operator ask Codex to pull linked pull request reviews, leave linked issue comments when useful, and decide whether the request is ready for human review or should return to work.
- Review decides whether the branch is approved, needs more work, or should be closed.

The request thread should remain continuous across the full request. If review sends work back, continue from the same thread and create a new execution record for the next agent run.

## Current Behavior

The workflow run stores the current step and is the source of truth for request progress.
