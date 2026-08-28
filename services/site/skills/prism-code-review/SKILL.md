---
name: prism-code-review
description: Review a linked pull request or repository change from fresh context, run appropriate local checks, record durable findings, and optionally maintain one idempotent Prism review comment on the pull request. Do not implement fixes, push commits, merge, approve, deploy, or mutate unrelated GitHub or Prism state.
---

# Prism Code Review

Perform an independent, evidence-based review of the current request's repository change.

## Boundaries

- Review only the target repository, linked pull request, request requirements, and durable implementation/review artifacts supplied for this run.
- Treat implementation summaries and PR descriptions as claims to verify against the diff and tests.
- Do not modify repository files, create commits, push branches, merge or approve pull requests, deploy, change labels or assignees, or implement fixes.
- Do not use unrelated Prism Memory, conversations, projects, credentials, or external systems.
- Never print or persist credential values.
- A GitHub comment is review communication, not approval. Never submit an approving or changes-requested GitHub review event.

## Inputs

Resolve and verify:

1. The request acceptance criteria and `triage-fix-notes.md` when present.
2. The target repository and base branch.
3. The linked GitHub pull request external ref, if present.
4. Immutable base and head commit SHAs. Report `inconclusive` if the reviewed head cannot be identified reliably.
5. Prior `code-review.json` findings for this request, when re-reviewing.

Inspect the actual `base...head` diff. Run focused tests, type checks, linters, or static analysis that are appropriate and practical. Tests may use temporary/cache paths, but must not alter tracked repository content. Check the final git status and report unexpected mutations as a blocker.

Prioritize correctness, security, data loss, authorization boundaries, concurrency, migrations, error handling, compatibility, and missing tests. Avoid style-only findings unless they materially affect maintenance or correctness.

## Durable outputs

Write or replace these request artifacts and include the current `agent_run_id`:

- `code-review.md`: concise human-readable review with reviewed SHAs, checks run, findings, and recommendation.
- `code-review.json`: structured review evidence.

Use this JSON shape:

```json
{
  "version": 1,
  "status": "approved",
  "baseSha": "...",
  "headSha": "...",
  "checks": [
    { "name": "typecheck", "status": "passed", "evidence": "npm run typecheck" }
  ],
  "findings": [
    {
      "id": "stable-finding-key",
      "severity": "blocking",
      "title": "Short finding",
      "path": "src/example.ts",
      "line": 42,
      "evidence": "What fails and why",
      "recommendation": "Smallest safe correction",
      "status": "open"
    }
  ],
  "summary": "..."
}
```

`status` must be `approved`, `changes_requested`, or `inconclusive`. Finding severity must be `blocking`, `high`, `medium`, or `low`. Preserve stable finding ids across re-reviews and mark resolved prior findings `resolved` rather than silently deleting their history.

## GitHub comment

When a linked GitHub pull request exists and GitHub write access is available, maintain one top-level PR conversation comment containing the concise review summary and a link or reference to the Prism request. Use this hidden marker:

```text
<!-- prism-code-review request:<request-number> -->
```

List existing PR issue comments first. If a comment by the authenticated Prism identity already contains that marker, update it with the latest reviewed head SHA and result. Otherwise create it. Do not create a new comment for every retry or head SHA.

Use the GitHub Issues comment endpoints for the pull request conversation, not the pull-request review approval endpoints. If commenting fails, preserve the local review artifacts and report the delivery failure without changing the technical review result.

## Workflow result

- When no blocking or high findings remain and the evidence is sufficient, return `approved` and omit a workflow-outcome block so the workflow may advance.
- For blocking or high findings, return `changes_requested` and include a fenced `workflow-outcome` block with `status: "needs_attention"`, one blocker per finding, and a recommendation to move back to `implement`.
- When repository, diff, or required test evidence is unavailable, return `inconclusive` with a `needs_attention` workflow outcome. Never fabricate readiness.

Keep the final response short because the durable artifacts are the source of truth.
