# Triage

Review the request, target repository, environment, comments, and recent thread history.

If repository access is configured and no linked GitHub issue external ref exists, create a GitHub issue in the target repository during triage. Use the request title as the issue title and include the request number, original request description, triage summary, and initial fix notes in the issue body. Attach the created issue as a GitHub `issue` external ref. If the request came from an existing GitHub issue or another durable external source, attach that source instead of creating a duplicate issue.

Produce a concise triage summary that identifies:

- the likely implementation scope
- important constraints or risks
- the target branch or environment context
- whether the request is ready for agent implementation

Create a durable markdown request artifact named `triage-fix-notes.md` with kind `triage-fix-notes`. The artifact should contain detailed fix notes for the implementation step:

- observed problem or requested change
- relevant files, systems, or target repo areas to inspect
- proposed implementation approach
- risks, edge cases, and validation plan
- any linked issue, pull request, Discord thread, deployment, or other external context

When triage is complete, leave enough context for the next workflow step or human gate to approve or redirect the work. Do not set legacy queue statuses; the workflow run's current step is the source of truth.
