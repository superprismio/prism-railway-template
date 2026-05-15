# Review

The human reviewer checks the branch, execution output, and any preview or compare links.

Use the latest PR Review Checkpoint output when available. If a linked pull request exists, final approval should consider PR review state, requested changes, checks, and linked issue comments. Final merge should still happen through GitHub or the target repository's normal review process unless the operator explicitly directs otherwise.

Review outcomes:

- approve the request when the work is acceptable
- request changes with specific feedback when more work is needed
- reject or close when the request should not proceed

When changes are requested, the next agent run should use the same request thread and the latest review feedback as primary context.
