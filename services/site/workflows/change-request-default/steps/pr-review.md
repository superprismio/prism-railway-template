# PR Review Checkpoint

Check the linked pull request and linked issue state without starting new implementation work by default.

Use the request details, latest comments, agent-run history, artifacts, and external refs. If a GitHub pull request ref exists, inspect the PR state, review comments, requested changes, failing checks, and merge readiness. If no pull request ref exists but a branch was pushed, create the PR into the target repository base branch when remote access is configured, then attach the PR external ref.

Expected behavior:

- read `triage-fix-notes.md` and any implementation artifacts before judging readiness
- fetch and summarize linked PR reviews, review comments, check status, and mergeability
- if reviewers requested changes, summarize the required fixes and say the request should return to `implement`
- if review feedback has been addressed and the PR is ready for human decision, say the request should move to `review`
- if a linked GitHub issue exists, leave a concise issue comment when there is meaningful new state such as PR opened, review changes requested, checks passing, or ready for final review
- do not merge the PR from this checkpoint
- do not fabricate review results when the GitHub API or repository access is unavailable

This checkpoint stays on the current step after running. Return a clear recommendation for the operator: move to `review`, move back to `implement`, or keep waiting.
