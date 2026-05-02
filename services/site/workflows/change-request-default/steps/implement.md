# Work

Implement the approved request in the target repository.

Use the triage summary, suggested changes, request description, linked thread history, and target environment context. Keep the work scoped to the request.

Expected behavior:

- prepare or reuse the request branch
- make the code/content/config changes
- run relevant checks when practical
- commit the result
- push the branch when remote access is configured
- return a review summary with branch, commit, test, and preview context when available

If review sends the request back with changes requested, continue from the existing request thread and address the review feedback in a new execution.

## Delegation

This step may use subagents when the implementation can be split into independent ownership areas, such as frontend, backend, docs, test verification, or deployment investigation.

Delegation rules:

- keep integration responsibility with the main agent
- do not delegate the immediate blocking task
- give each subagent a concrete, bounded task
- assign clear file or module ownership for code changes
- avoid overlapping write scopes between subagents
- use at most three subagents for this step
