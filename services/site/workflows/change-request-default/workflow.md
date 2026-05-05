# Change Request Workflow

This workflow covers repository-backed Prism requests that need Codex to triage, implement, and prepare work for human review.

The workflow keeps human gates explicit:

- Triage turns an inbox request into a reviewed plan.
- Approval starts implementation.
- Review decides whether the branch is approved, needs more work, or should be closed.

The request thread should remain continuous across the full request. If review sends work back, continue from the same thread and create a new execution record for the next agent run.

## Current Behavior

This workflow mirrors the existing request board behavior. The app still stores request state in the database and uses the request status as the current workflow projection.

Status mapping:

- `submitted`, `triaging`, `needs-human-input`: Triage
- `ready-for-agent`: Approve
- `in-progress`, `changes-requested`: Work
- `awaiting-review`: Review
- `approved`, `rejected`, `closed`: Closed
