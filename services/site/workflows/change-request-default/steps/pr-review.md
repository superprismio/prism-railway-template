# External PR Review Checkpoint

Refresh the linked pull request's external review and check state without starting implementation work.

Use the `prism-code-review` skill and read the latest `code-review.md` and `code-review.json` first. Inspect GitHub review comments, requested changes, checks, and merge readiness, including CodeRabbit, Copilot, or human review state when present. If no pull request ref exists, report the missing handoff instead of creating a PR from this checkpoint.

Expected behavior:

- preserve the local review's immutable head SHA and report when the PR head has changed since that review
- fetch and summarize linked PR reviews, review comments, check status, and mergeability
- if reviewers requested changes, summarize the required fixes and say the request should return to `implement`
- if review feedback has been addressed and the PR is ready for human decision, say the request should move to `review`
- update the existing marker-based Prism PR comment only when there is meaningful new state
- do not merge the PR from this checkpoint
- do not fabricate review results when the GitHub API or repository access is unavailable

This checkpoint stays on the current step after running. Return a clear recommendation for the operator: move to `review`, move back to `implement`, or keep waiting.
