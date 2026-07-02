# Review

The human reviewer checks the branch, latest agent-run output, and any preview or compare links.

Use the latest PR Review Checkpoint output when available. If a linked pull request exists, final approval should consider PR review state, requested changes, checks, and linked issue comments. Final merge should still happen through GitHub or the target repository's normal review process unless the operator explicitly directs otherwise.

Review outcome:

- continue the workflow when the work is acceptable and ready to close

When changes are requested, add specific feedback and use the explicit change-step/send-back control to return to implementation. When the request should not proceed, use the explicit cancel/close control.
