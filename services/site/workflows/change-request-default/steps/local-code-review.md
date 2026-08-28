# Local Code Review

Independently review the implemented repository change before waiting on external pull-request reviewers.

Use the `prism-code-review` skill. Start from fresh step context and verify the actual diff against the request requirements; do not rely on the implementation agent's conclusions. Read `triage-fix-notes.md`, the linked pull request external ref, implementation artifacts, and any prior `code-review.json` artifact.

Required outcomes:

- identify immutable base and head SHAs
- inspect the complete relevant diff
- run focused local checks when practical
- write or replace `code-review.md` and `code-review.json` with the current agent run id
- maintain the single idempotent Prism review comment on the linked GitHub pull request when GitHub comment access is available
- do not modify code, commit, push, merge, approve, deploy, or mutate unrelated request/GitHub state

If blocking or high findings remain, return `needs_attention` using the workflow-outcome contract so this step stays active until an operator sends the request back to `implement` or explicitly overrides it. If the review is clean and sufficiently evidenced, complete the step so the workflow advances to the external PR review checkpoint.
