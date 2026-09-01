# Verify

Independently verify the current implementation before code review.

Use the `prism-code-verification` skill from fresh step context. Read the request acceptance criteria, `triage-fix-notes.md`, implementation artifacts, applicable repository policy, and any prior `verification.json`. Verify the current immutable base and head SHAs rather than trusting the implementation summary.

Required behavior:

- inspect the complete relevant diff and select checks proportionate to the changed paths
- run the repository's relevant lint, type, test, build, and runtime checks
- for user-facing changes, execute representative browser journeys and inspect console and network failures
- leave tracked source and external systems unchanged
- clean up local servers and browser processes
- write or replace `verification.md` and validated `verification.json` with the current agent run id

A conclusive `passed` or `failed` verification completes this step. Failed evidence advances to the independent reviewer, which records actionable findings for the deterministic repair loop. Use `needs_attention` only when verification is `inconclusive`, including when the target, repository, environment, or a required runtime capability is unavailable.
